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
 * Three deliberate choices guard against fooling ourselves:
 *  - The checker is a DIFFERENT model from the generator (see getCheckerModel),
 *    because a generator and checker from the same weights share blind spots.
 *  - The checker is prompted ADVERSARIALLY: assume each claim is unsupported
 *    until the context proves otherwise, rather than looking for reasons to agree.
 *  - The supporting quote is then MECHANICALLY verified: a claim only counts as
 *    supported if its quote is an actual substring of a retrieved chunk. This
 *    shifts the signal from "a model agreed" to "a model pointed at text that
 *    provably exists," and catches a checker that hallucinates its own evidence.
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
  /** The checker model's judgment: does the context support it? */
  supported: boolean;
  /** The quote the checker offered as support, or "" when unsupported. */
  evidence: string;
  /** Mechanical check: is that quote actually present in a retrieved chunk? */
  evidenceLocated: boolean;
  /** 1-based index of the chunk the quote was found in, or null. */
  sourceIndex: number | null;
}

export interface Faithfulness {
  verdict: FaithfulnessVerdict;
  /** Fraction of claims that are both judged supported AND have a located quote. */
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
          .describe(
            "the supporting text copied VERBATIM (character-for-character) from the context, or \"\" if unsupported",
          ),
      }),
    )
    .describe("every distinct factual claim in the answer, each judged against the context"),
});

/** Normalize text for a forgiving substring match: lowercase, collapse whitespace, drop punctuation. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure: find which chunk a supporting quote actually came from. Returns the
 * 1-based chunk index if the (normalized) quote is a substring of a chunk, else
 * null. A too-short quote is treated as not located — it is not real evidence.
 */
export function locateEvidence(evidence: string, chunkTexts: string[]): number | null {
  const q = normalizeForMatch(evidence);
  if (q.length < 8) return null;
  for (let i = 0; i < chunkTexts.length; i++) {
    if (normalizeForMatch(chunkTexts[i]).includes(q)) return i + 1;
  }
  return null;
}

/**
 * Pure: turn per-claim checks into an overall verdict. A claim only counts toward
 * the score when the model judged it supported AND its quote was located in a
 * chunk — so a hallucinated or absent quote drops the claim, regardless of what
 * the model said. Kept separate from the model call so the rule is unit-testable.
 */
export function summarize(claims: ClaimCheck[]): {
  verdict: FaithfulnessVerdict;
  score: number;
  unsupported: string[];
} {
  if (claims.length === 0) return { verdict: "skipped", score: 1, unsupported: [] };
  const verified = (c: ClaimCheck) => c.supported && c.evidenceLocated;
  const unsupported = claims.filter((c) => !verified(c)).map((c) => c.claim);
  const score = (claims.length - unsupported.length) / claims.length;
  const verdict: FaithfulnessVerdict =
    score === 1 ? "supported" : score >= 0.5 ? "partial" : "unsupported";
  return { verdict, score, unsupported };
}

/**
 * Verify a generated answer against the context it was supposed to come from.
 * A separate model pass acting as a strict fact-checker, followed by a mechanical
 * check that each supporting quote really exists in the retrieved chunks.
 */
export async function verifyFaithfulness(
  answer: string,
  hits: SearchHit[],
  opts: { provider?: string } = {},
): Promise<Faithfulness> {
  if (!answer.trim() || hits.length === 0) {
    return { verdict: "skipped", score: 1, claims: [], unsupported: [], usage: { ...ZERO_USAGE } };
  }

  const chunkTexts = hits.map((h) => h.chunk.text);
  const context = chunkTexts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");

  const { object, usage } = await generateObject({
    model: getCheckerModel(opts.provider),
    schema: claimsSchema,
    system:
      "You are an adversarial fact-checker. Your default stance is distrust: treat every claim " +
      "as UNSUPPORTED until the CONTEXT explicitly proves otherwise. Break the ANSWER into its " +
      "individual factual claims. Mark a claim supported ONLY when you can copy a span of the " +
      "context, VERBATIM, that directly states or clearly implies it. Your own outside knowledge " +
      "does not count, even if the claim is true. When in doubt, mark it unsupported and leave " +
      "evidence empty. Never paraphrase the evidence — copy it exactly as written.",
    prompt: `CONTEXT:\n${context}\n\nANSWER:\n${answer}\n\nJudge each claim in the answer against the context.`,
  });

  const claims: ClaimCheck[] = object.claims.map((c) => {
    const sourceIndex = c.supported ? locateEvidence(c.evidence, chunkTexts) : null;
    return { ...c, evidenceLocated: sourceIndex !== null, sourceIndex };
  });
  const { verdict, score, unsupported } = summarize(claims);
  return { verdict, score, claims, unsupported, usage: normalizeUsage(usage) };
}
