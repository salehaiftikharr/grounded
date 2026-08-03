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

// An uploaded document is a single-topic corpus: every chunk is about the same
// thing, so the relative-margin test — which asks "does the top hit stand out
// from an unrelated pile?" — has no unrelated pile to work with and wrongly
// refuses genuinely answerable questions. For uploads we therefore drop the
// margin test and lean on a lower absolute floor, tuned so a casually-phrased
// question about the document still clears it while a truly off-topic question
// (which lands far lower) does not. The faithfulness check remains the backstop.
export const UPLOAD_POLICY: GroundingPolicy = { minTopScore: 0.22, minHits: 1, minMargin: 0 };

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

/**
 * How far the top hit stands out from this query's candidate distribution, in
 * standard deviations (a z-score). This is the number that actually explains a
 * grounding decision: a real match sits well above the pile, a near-miss sits in
 * it. Returns null when there are too few candidates to form a distribution.
 */
export function topMargin(topScore: number, candidateScores: number[]): number | null {
  if (candidateScores.length < 4) return null;
  const mu = mean(candidateScores);
  const sd = stdev(candidateScores, mu);
  if (sd === 0) return null;
  return (topScore - mu) / sd;
}

export const REFUSAL =
  "I don't have enough grounded information in the corpus to answer that confidently.";

/** The system prompt for the answerer, factual vs overview mode. Shared by the
 *  batch (answerQuestion) and streaming answer paths so the two never drift. */
export function answerSystemPrompt(overview: boolean): string {
  return overview
    ? "You are given numbered excerpts from a single document. Give a clear, confident overview of what the document is about, synthesizing across ONLY these excerpts. Cite the excerpts you draw on as [1], [2], and so on. Answer directly; do not narrate what the excerpts do or do not contain. Do not use outside knowledge. Only if the excerpts are genuinely too fragmentary to tell, say so plainly."
    : "You answer questions using ONLY the provided context, and you answer them directly and completely. Synthesize across the numbered context blocks and give the best supported answer they allow, citing the blocks you use inline as [1], [2], and so on. Answer in a confident, natural voice, but stay close to what the context actually says: do not add superlatives, characterizations, or framing that the context does not contain, since every sentence you write is checked back against the sources. Do NOT preface your answer with meta-commentary such as 'based on the provided context' or 'the context does not give a full definition'; just state what the context establishes. Only if the context does not address the question at all should you say you do not know. Never use outside knowledge or invent details the context does not support.";
}

/** Build the numbered context block the answerer is prompted with. */
export function buildContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] (${h.chunk.source ?? h.chunk.id})\n${h.chunk.text}`)
    .join("\n\n");
}

/** The user prompt shared by the batch and streaming answer paths. */
export function answerPrompt(context: string, question: string): string {
  return `Context:\n${context}\n\nQuestion: ${question}\n\nGrounded, cited answer:`;
}

/** Whether retrieval is strong enough to answer at all: overview questions ground
 *  on "a corpus exists", everything else goes through the full similarity gate. */
export function isAnswerable(
  hits: SearchHit[],
  candidateScores: number[],
  overview: boolean,
  policy: GroundingPolicy = DEFAULT_POLICY,
): boolean {
  return overview ? hits.length >= policy.minHits : isGrounded(hits, candidateScores, policy);
}

// Overview questions ("what is this about?", "summarize this", "key points")
// barely match any single chunk on similarity, so similarity gating wrongly
// refuses them even when the corpus obviously holds the answer. Detect them so
// the answerer can ground on "a corpus exists" and summarize across it instead.
export function isOverviewQuestion(question: string): boolean {
  return /what(?:'?s| is| are)?\s+(?:this|it|the)\s+(?:(?:document|doc|book|text|file|handbook|paper|report|thing)\s+)?(?:about|cover|contain)\b|summ?ari[sz]e|\bsummary\b|\boverview\b|tl;?dr|main\s+(?:points?|ideas?|topics?|themes?|takeaways?)|key\s+(?:points?|takeaways?|ideas?|themes?)|the\s+gist|high[-\s]?level|what\s+kind\s+of\s+(?:document|book|text|doc|report)/i.test(
    question,
  );
}

export async function answerQuestion(
  question: string,
  hits: SearchHit[],
  opts: {
    provider?: string;
    policy?: GroundingPolicy;
    verify?: boolean;
    candidateScores?: number[];
    overview?: boolean;
  } = {},
): Promise<Answer> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const overview = opts.overview ?? isOverviewQuestion(question);

  if (!isAnswerable(hits, opts.candidateScores ?? [], overview, policy)) {
    return {
      grounded: false,
      text: REFUSAL,
      citations: [],
      usage: { ...ZERO_USAGE },
      timings: { generateMs: 0, verifyMs: 0 },
    };
  }

  const { result: gen, ms: generateMs } = await timed(() =>
    generateText({
      model: getChatModel(opts.provider),
      system: answerSystemPrompt(overview),
      prompt: answerPrompt(buildContext(hits), question),
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
