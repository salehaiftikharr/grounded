import { generateObject } from "ai";
import { z } from "zod";
import { getCheckerModel } from "./model";
import { normalizeUsage, ZERO_USAGE, type TokenUsage } from "./observe";
import type { SearchHit } from "./store";

/**
 * The output-side guard.
 *
 * The grounding gate (see answer.ts) decides whether retrieval is strong enough
 * to answer at all. But a model can still drift past its context even when
 * retrieval succeeds — stating something the sources never actually say. The
 * faithfulness check is the second gate: it breaks the generated answer into
 * individual claims and verifies each one against the retrieved context, so a
 * claim the context does not support gets flagged instead of trusted.
 *
 * Two deliberate choices guard against fooling ourselves:
 *  - The checker is a DIFFERENT model from the generator (see getCheckerModel),
 *    because a generator and checker from the same weights share blind spots.
 *  - The checker is prompted ADVERSARIALLY: assume each claim is unsupported
 *    until the context proves otherwise, rather than looking for reasons to agree.
 *
 * Scope, stated honestly: this measures faithfulness to the RETRIEVED EVIDENCE,
 * not truth. If retrieval surfaces a chunk that is similar-but-wrong, an answer
 * can be perfectly faithful to it and still false. The grounding gate and the
 * corpus quality are what this check assumes; it does not replace them.
 */

export type FaithfulnessVerdict = "supported" | "partial" | "unsupported" | "skipped";

export interface ClaimCheck {
  /** A single factual statement pulled out of the answer. */
  claim: string;
  /** Does the retrieved context actually support it? */
  supported: boolean;
  /** A short quote from the context that backs it, or "" when unsupported. */
  evidence: string;
}

export interface Faithfulness {
  verdict: FaithfulnessVerdict;
  /** Fraction of claims the context supports, in [0, 1]. */
  score: number;
  claims: ClaimCheck[];
  unsupported: string[];
  usage: TokenUsage;
}

const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().describe("a single, self-contained factual statement made by the answer"),
        supported: z
          .boolean()
          .describe("true ONLY if the context states or clearly implies this claim"),
        evidence: z
          .string()
          .describe("a short verbatim quote from the context that supports the claim, or \"\" if unsupported"),
      }),
    )
    .describe("every distinct factual claim in the answer, each judged against the context"),
});

/**
 * Pure: turn a set of per-claim checks into an overall verdict. Kept separate
 * from the model call so the scoring rule is deterministic and unit-testable.
 */
export function summarize(claims: ClaimCheck[]): {
  verdict: FaithfulnessVerdict;
  score: number;
  unsupported: string[];
} {
  if (claims.length === 0) return { verdict: "skipped", score: 1, unsupported: [] };
  const unsupported = claims.filter((c) => !c.supported).map((c) => c.claim);
  const score = (claims.length - unsupported.length) / claims.length;
  const verdict: FaithfulnessVerdict =
    score === 1 ? "supported" : score >= 0.5 ? "partial" : "unsupported";
  return { verdict, score, unsupported };
}

/**
 * Verify a generated answer against the context it was supposed to come from.
 * A separate model pass acting as a strict fact-checker — outside knowledge does
 * not count, only what the retrieved chunks actually say.
 */
export async function verifyFaithfulness(
  answer: string,
  hits: SearchHit[],
  opts: { provider?: string } = {},
): Promise<Faithfulness> {
  if (!answer.trim() || hits.length === 0) {
    return { verdict: "skipped", score: 1, claims: [], unsupported: [], usage: { ...ZERO_USAGE } };
  }

  const context = hits.map((h, i) => `[${i + 1}] ${h.chunk.text}`).join("\n\n");

  const { object, usage } = await generateObject({
    model: getCheckerModel(opts.provider),
    schema: claimsSchema,
    system:
      "You are an adversarial fact-checker. Your default stance is distrust: treat every claim " +
      "as UNSUPPORTED until the CONTEXT explicitly proves otherwise. Break the ANSWER into its " +
      "individual factual claims. Mark a claim supported ONLY when you can quote a span of the " +
      "context that directly states or clearly implies it. Your own outside knowledge does not " +
      "count, even if the claim is true. When in doubt, mark it unsupported and leave evidence empty.",
    prompt: `CONTEXT:\n${context}\n\nANSWER:\n${answer}\n\nJudge each claim in the answer against the context.`,
  });

  const claims = object.claims as ClaimCheck[];
  const { verdict, score, unsupported } = summarize(claims);
  return { verdict, score, claims, unsupported, usage: normalizeUsage(usage) };
}
