import { VectorStore, type SearchHit } from "./store";
import { embedQuery } from "./embed";
import { searchSessionChunks } from "./db";

/** Significant query terms (lowercased, de-duped, short tokens dropped). */
export function queryTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))];
}

/**
 * Rerank candidates by blending the vector score with lexical overlap, so a
 * chunk that is both semantically close AND shares the query's key terms rises.
 * Pure and cheap — a stand-in for a cross-encoder/LLM reranker, which would slot
 * in here. `weight` is how much lexical overlap counts (0 = pure vector).
 */
export function rerank(query: string, hits: SearchHit[], weight = 0.2): SearchHit[] {
  const terms = new Set(queryTerms(query));
  if (!terms.size) return hits;
  return hits
    .map((h) => {
      const hitTerms = new Set(queryTerms(h.chunk.text));
      let overlap = 0;
      for (const t of terms) if (hitTerms.has(t)) overlap++;
      const lexical = overlap / terms.size;
      return { chunk: h.chunk, score: h.score * (1 - weight) + lexical * weight };
    })
    .sort((a, b) => b.score - a.score);
}

export interface Retrieval {
  /** The top-k reranked hits used to answer. */
  hits: SearchHit[];
  /**
   * Reranked scores of the whole candidate set. This is the per-query baseline
   * the grounding gate judges against: "does the top hit actually stand out from
   * everything else this corpus returned, or is it just the tallest of a flat,
   * unrelated pile?" — which transfers across corpora better than a fixed cutoff.
   */
  candidateScores: number[];
}

/**
 * The query half of RAG: embed the query, vector-search a wide candidate set,
 * rerank, and keep the top-k. Retrieving wide then reranking narrow is what gives
 * the reranker something to improve on — and the wide set's score distribution is
 * what lets the grounding gate be relative rather than a brittle absolute cutoff.
 */
export async function retrieve(
  store: VectorStore,
  query: string,
  opts: { k?: number; candidates?: number } = {},
): Promise<Retrieval> {
  const k = opts.k ?? 4;
  const candidates = opts.candidates ?? Math.max(k * 4, 12);
  const queryEmbedding = await embedQuery(query);
  const hits = store.search(queryEmbedding, candidates);
  return finalize(query, hits, k);
}

/**
 * The same query half of RAG, but over a session's uploaded corpus in Postgres.
 * The candidate search runs in the database (pgvector), then the identical
 * rerank and relative grounding baseline apply, so bring-your-own-document
 * answers pass through exactly the same gates as the built-in corpus.
 */
export async function retrieveFromSession(
  sessionId: string,
  query: string,
  opts: { k?: number; candidates?: number } = {},
): Promise<Retrieval> {
  const k = opts.k ?? 4;
  const candidates = opts.candidates ?? Math.max(k * 4, 12);
  const queryEmbedding = await embedQuery(query);
  const hits = await searchSessionChunks(sessionId, queryEmbedding, candidates);
  return finalize(query, hits, k);
}

/** Rerank a candidate set and split into the top-k plus the score baseline. */
function finalize(query: string, hits: SearchHit[], k: number): Retrieval {
  const reranked = rerank(query, hits);
  return { hits: reranked.slice(0, k), candidateScores: reranked.map((h) => h.score) };
}
