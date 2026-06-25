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
  adversarial: boolean;
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
  /** Clear out-of-corpus questions the gate must refuse. */
  refusal: { correct: number; total: number };
  /**
   * Adversarial near-misses: topically adjacent but uncovered. The grounding gate
   * alone is not expected to catch all of these — that is what the generator's
   * "say you don't know" instruction and the faithfulness check are for — so a
   * leak here is reported as a warning, not a hard failure.
   */
  adversarial: { refused: number; total: number };
  /** Mean faithfulness over answered in-corpus cases; null when not measured. */
  faithfulness: { mean: number; total: number } | null;
  /**
   * How often a claim the checker judged supported also had its quote located in
   * a source. A low rate would mean the verbatim-substring requirement is dropping
   * legitimately-supported claims (false unsupported) — the cost of the mechanical
   * check, measured rather than assumed. null when faithfulness was not run.
   */
  quoteLocation: { located: number; supported: number; rate: number } | null;
  /** Hard pass: retrieval hits + clear refusals all correct. */
  passed: boolean;
}

export async function evaluate(
  store: VectorStore,
  opts: { cases?: EvalCase[]; provider?: string; verify?: boolean; onLog?: (m: string) => void } = {},
): Promise<EvalReport> {
  const cases = opts.cases ?? defaultCases;
  const log = opts.onLog ?? (() => {});
  const results: EvalResult[] = [];
  let supportedClaims = 0;
  let locatedClaims = 0;

  for (const c of cases) {
    log(`asking "${c.question}"…`);
    const { hits, candidateScores } = await retrieve(store, c.question);
    const retrievedSources = [...new Set(hits.map((h) => h.chunk.source ?? h.chunk.id))];
    const topScore = hits[0]?.score ?? 0;
    const grounded = isGrounded(hits, candidateScores);

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
      const answer = await answerQuestion(c.question, hits, {
        provider: opts.provider,
        verify: true,
        candidateScores,
      });
      faithfulness = answer.faithfulness?.score;
      for (const cl of answer.faithfulness?.claims ?? []) {
        if (cl.supported) {
          supportedClaims++;
          if (cl.evidenceLocated) locatedClaims++;
        }
      }
    }

    results.push({
      question: c.question,
      expectSource: c.expectSource,
      adversarial: c.adversarial ?? false,
      retrievedSources,
      topScore,
      retrievalHit,
      grounded,
      correct,
      faithfulness,
    });
  }

  const inCorpus = results.filter((r) => r.expectSource !== null);
  const clearOut = results.filter((r) => r.expectSource === null && !r.adversarial);
  const adversarialOut = results.filter((r) => r.expectSource === null && r.adversarial);
  const retrievalHits = inCorpus.filter((r) => r.retrievalHit).length;
  const refusedClear = clearOut.filter((r) => !r.grounded).length;
  const refusedAdversarial = adversarialOut.filter((r) => !r.grounded).length;

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
    refusal: { correct: refusedClear, total: clearOut.length },
    adversarial: { refused: refusedAdversarial, total: adversarialOut.length },
    faithfulness,
    quoteLocation: faithfulness
      ? { located: locatedClaims, supported: supportedClaims, rate: supportedClaims ? locatedClaims / supportedClaims : 1 }
      : null,
    passed: retrievalHits === inCorpus.length && refusedClear === clearOut.length,
  };
}
