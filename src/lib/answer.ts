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
  /** Absolute floor on top-hit similarity — a backstop, kept deliberately low. */
  minTopScore: number;
  /** Minimum number of retrieved hits required. */
  minHits: number;
  /**
   * Relative margin: how far above the candidate set's mean score the top hit
   * must sit, measured in standard deviations (a z-score). This is the part that
   * transfers across corpora — a real match stands out from the pile; a near-miss
   * sits in it. Set to 0 to disable and fall back to the absolute floor only.
   */
  minMargin: number;
}

// The gate now requires BOTH tests to pass. The absolute floor catches a hit that
// is simply too weak in similarity terms (the adversarial near-miss topped out at
// 0.344, so the floor sits at 0.40). The relative margin catches the case a fixed
// floor cannot: a corpus where everything scores high, where the question is not
// "is the top score big?" but "does the top hit actually stand out from the rest?"
export const DEFAULT_POLICY: GroundingPolicy = { minTopScore: 0.4, minHits: 1, minMargin: 1.0 };

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[], mu: number): number {
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
}

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

/**
 * The grounding gate: is retrieved context strong enough to answer at all?
 *
 * A hit must clear a low absolute floor AND stand out from this query's own
 * candidate distribution by `minMargin` standard deviations. The relative test is
 * the one that matters and the one that transfers across corpora; pass the
 * candidate scores from `retrieve` to enable it. With too few candidates to form a
 * distribution, it falls back to the absolute floor.
 */
export function isGrounded(
  hits: SearchHit[],
  candidateScores: number[] = [],
  policy: GroundingPolicy = DEFAULT_POLICY,
): boolean {
  if (hits.length < policy.minHits) return false;
  const top = hits[0]?.score ?? 0;
  if (top < policy.minTopScore) return false;

  if (policy.minMargin <= 0 || candidateScores.length < 4) return true;
  const mu = mean(candidateScores);
  const sd = stdev(candidateScores, mu);
  if (sd === 0) return true;
  const z = (top - mu) / sd;
  return z >= policy.minMargin;
}

const REFUSAL =
  "I don't have enough grounded information in the corpus to answer that confidently.";

export async function answerQuestion(
  question: string,
  hits: SearchHit[],
  opts: {
    provider?: string;
    policy?: GroundingPolicy;
    verify?: boolean;
    candidateScores?: number[];
  } = {},
): Promise<Answer> {
  const policy = opts.policy ?? DEFAULT_POLICY;

  if (!isGrounded(hits, opts.candidateScores ?? [], policy)) {
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
