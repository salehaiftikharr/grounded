import { generateText } from "ai";
import { getChatModel } from "./model";
import type { SearchHit } from "./store";

/**
 * The answerer, with the grounding gate in front of it. Generation only happens
 * when retrieval is strong enough; otherwise the system refuses rather than
 * guessing. The model is instructed to answer only from the supplied context and
 * to cite the chunks it used.
 */

export interface GroundingPolicy {
  /** Minimum top-hit similarity required to attempt an answer. */
  minTopScore: number;
  /** Minimum number of retrieved hits required. */
  minHits: number;
}

export const DEFAULT_POLICY: GroundingPolicy = { minTopScore: 0.3, minHits: 1 };

export interface Citation {
  source?: string;
  id: string;
  score: number;
}

export interface Answer {
  grounded: boolean;
  text: string;
  citations: Citation[];
}

/** The grounding gate: is retrieved context strong enough to answer at all? */
export function isGrounded(hits: SearchHit[], policy: GroundingPolicy = DEFAULT_POLICY): boolean {
  return hits.length >= policy.minHits && (hits[0]?.score ?? 0) >= policy.minTopScore;
}

const REFUSAL =
  "I don't have enough grounded information in the corpus to answer that confidently.";

export async function answerQuestion(
  question: string,
  hits: SearchHit[],
  opts: { provider?: string; policy?: GroundingPolicy } = {},
): Promise<Answer> {
  const policy = opts.policy ?? DEFAULT_POLICY;

  if (!isGrounded(hits, policy)) {
    return { grounded: false, text: REFUSAL, citations: [] };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] (${h.chunk.source ?? h.chunk.id})\n${h.chunk.text}`)
    .join("\n\n");

  const { text } = await generateText({
    model: getChatModel(opts.provider),
    system:
      "You answer ONLY from the provided context. Cite sources inline as [1], [2]… matching the numbered context blocks you used. If the context does not contain the answer, say you do not know — never use outside knowledge or guess.",
    prompt: `Context:\n${context}\n\nQuestion: ${question}\n\nGrounded, cited answer:`,
  });

  return {
    grounded: true,
    text,
    citations: hits.map((h) => ({ source: h.chunk.source, id: h.chunk.id, score: h.score })),
  };
}
