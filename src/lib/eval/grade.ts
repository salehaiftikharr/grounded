import { VectorStore } from "../store";
import { retrieve } from "../retrieve";
import { answerQuestion, isGrounded } from "../answer";
import { cases as defaultCases, type EvalCase } from "./cases";

/**
 * Evaluate the retrieval + grounding behavior, not just the final wording.
 *
 * Two things are graded:
 *  - retrieval hit-rate: for in-corpus questions, did the expected source make
 *    the top-k?
 *  - grounding discipline: for out-of-corpus questions, did the gate refuse?
 *
 * A confident answer to an out-of-corpus question is the failure that matters —
 * the same "never ship the wrong thing" stance as Forge's verification gate,
 * applied to retrieval.
 */

export interface EvalResult {
  question: string;
  expectSource: string | null;
  retrievedSources: string[];
  topScore: number;
  retrievalHit: boolean;
  grounded: boolean;
  correct: boolean;
  /** Set only when faithfulness verification ran for this case. */
  faithfulness?: number;
}

export interface EvalReport {
  results: EvalResult[];
  retrieval: { hits: number; total: number; rate: number };
  refusal: { correct: number; total: number };
  /** Mean faithfulness over answered in-corpus cases; null when not measured. */
  faithfulness: { mean: number; total: number } | null;
  correct: number;
  total: number;
  accuracy: number;
}

export async function evaluate(
  store: VectorStore,
  opts: { cases?: EvalCase[]; provider?: string; verify?: boolean; onLog?: (m: string) => void } = {},
): Promise<EvalReport> {
  const cases = opts.cases ?? defaultCases;
  const log = opts.onLog ?? (() => {});
  const results: EvalResult[] = [];

  for (const c of cases) {
    log(`asking "${c.question}"…`);
    const hits = await retrieve(store, c.question);
    const retrievedSources = [...new Set(hits.map((h) => h.chunk.source ?? h.chunk.id))];
    const topScore = hits[0]?.score ?? 0;
    const grounded = isGrounded(hits);

    let retrievalHit = false;
    let correct: boolean;
    if (c.expectSource === null) {
      // Out of corpus: correct iff the gate refused.
      correct = !grounded;
    } else {
      retrievalHit = retrievedSources.includes(c.expectSource);
      correct = retrievalHit && grounded;
    }

    // Optional, costs a generation + a verification pass per answered case.
    let faithfulness: number | undefined;
    if (opts.verify && grounded && c.expectSource !== null) {
      const answer = await answerQuestion(c.question, hits, { provider: opts.provider, verify: true });
      faithfulness = answer.faithfulness?.score;
    }

    results.push({
      question: c.question,
      expectSource: c.expectSource,
      retrievedSources,
      topScore,
      retrievalHit,
      grounded,
      correct,
      faithfulness,
    });
  }

  const inCorpus = results.filter((r) => r.expectSource !== null);
  const outCorpus = results.filter((r) => r.expectSource === null);
  const retrievalHits = inCorpus.filter((r) => r.retrievalHit).length;
  const refusedCorrectly = outCorpus.filter((r) => !r.grounded).length;
  const correct = results.filter((r) => r.correct).length;

  const scored = results.filter((r) => typeof r.faithfulness === "number");
  const faithfulness = scored.length
    ? { mean: scored.reduce((s, r) => s + (r.faithfulness ?? 0), 0) / scored.length, total: scored.length }
    : null;

  return {
    results,
    retrieval: {
      hits: retrievalHits,
      total: inCorpus.length,
      rate: inCorpus.length ? retrievalHits / inCorpus.length : 0,
    },
    refusal: { correct: refusedCorrectly, total: outCorpus.length },
    faithfulness,
    correct,
    total: results.length,
    accuracy: results.length ? correct / results.length : 0,
  };
}
