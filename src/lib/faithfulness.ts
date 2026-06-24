import { generateObject } from "ai";
import { z } from "zod";
import { getChatModel } from "./model";
import { normalizeUsage, ZERO_USAGE, type TokenUsage } from "./observe";
import type { SearchHit } from "./store";

/**
 * The output-side guard.
 *
 * The grounding gate (see answer.ts) decides whether retrieval is strong enough
 * to answer at all. But a model can still drift past its context even when
 * retrieval succeeds — stating something true-sounding that the sources never
 * actually say. The faithfulness check is the second gate: it breaks the
 * generated answer into individual claims and verifies each one against the
 * retrieved context, so an unsupported sentence gets flagged instead of trusted.
 *
 * Input gate refuses when it cannot find the evidence; output gate flags when the
 * answer outran the evidence. Together they cover both ways a RAG system lies.
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
    model: getChatModel(opts.provider),
    schema: claimsSchema,
    system:
      "You are a strict fact-checker. Break the ANSWER into its individual factual claims. " +
      "For each claim decide whether the CONTEXT directly supports it. A claim is supported " +
      "ONLY if the context states or clearly implies it; your own outside knowledge does not " +
      "count. Quote the supporting span as evidence, or leave evidence empty when unsupported.",
    prompt: `CONTEXT:\n${context}\n\nANSWER:\n${answer}\n\nJudge each claim in the answer against the context.`,
  });

  const claims = object.claims as ClaimCheck[];
  const { verdict, score, unsupported } = summarize(claims);
  return { verdict, score, claims, unsupported, usage: normalizeUsage(usage) };
}
