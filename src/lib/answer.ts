import { generateText } from "ai";
import { getChatModel } from "./model";
import { verifyFaithfulness, type Faithfulness } from "./faithfulness";
import { normalizeUsage, sumUsage, timed, ZERO_USAGE, type TokenUsage } from "./observe";
import type { SearchHit } from "./store";

/**
 * The answerer, wrapped in two guards. The grounding gate in front decides
 * whether retrieval is strong enough to answer at all; otherwise the system
 * refuses rather than guessing. After generation, an optional faithfulness check
 * verifies the answer against its sources, so a confident-but-unsupported claim
 * gets flagged instead of trusted. The model is told to answer only from the
 * supplied context and to cite the chunks it used.
 */

export interface GroundingPolicy {
  /** Minimum top-hit similarity required to attempt an answer. */
  minTopScore: number;
  /** Minimum number of retrieved hits required. */
  minHits: number;
}

// minTopScore was 0.3 until the eval's adversarial case (on-topic vocabulary the
// corpus never covers) slipped in at 0.344, while every genuine in-corpus query
// scores 0.52+. Raised to 0.40 to sit in that gap: refuse the near-miss, keep the
// real hits.
export const DEFAULT_POLICY: GroundingPolicy = { minTopScore: 0.4, minHits: 1 };

export interface Citation {
  source?: string;
  id: string;
  score: number;
}

export interface Answer {
  grounded: boolean;
  text: string;
  citations: Citation[];
  usage: TokenUsage;
  /** Present only when verification ran (i.e. an answer was generated). */
  faithfulness?: Faithfulness;
  timings: { generateMs: number; verifyMs: number };
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
  opts: { provider?: string; policy?: GroundingPolicy; verify?: boolean } = {},
): Promise<Answer> {
  const policy = opts.policy ?? DEFAULT_POLICY;

  if (!isGrounded(hits, policy)) {
    return {
      grounded: false,
      text: REFUSAL,
      citations: [],
      usage: { ...ZERO_USAGE },
      timings: { generateMs: 0, verifyMs: 0 },
    };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] (${h.chunk.source ?? h.chunk.id})\n${h.chunk.text}`)
    .join("\n\n");

  const { result: gen, ms: generateMs } = await timed(() =>
    generateText({
      model: getChatModel(opts.provider),
      system:
        "You answer ONLY from the provided context. Cite sources inline as [1], [2]… matching the numbered context blocks you used. If the context does not contain the answer, say you do not know — never use outside knowledge or guess.",
      prompt: `Context:\n${context}\n\nQuestion: ${question}\n\nGrounded, cited answer:`,
    }),
  );

  let faithfulness: Faithfulness | undefined;
  let verifyMs = 0;
  if (opts.verify) {
    const checked = await timed(() => verifyFaithfulness(gen.text, hits, { provider: opts.provider }));
    faithfulness = checked.result;
    verifyMs = checked.ms;
  }

  const usage = sumUsage(normalizeUsage(gen.usage), faithfulness?.usage ?? { ...ZERO_USAGE });

  return {
    grounded: true,
    text: gen.text,
    citations: hits.map((h) => ({ source: h.chunk.source, id: h.chunk.id, score: h.score })),
    usage,
    faithfulness,
    timings: { generateMs, verifyMs },
  };
}
