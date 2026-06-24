import { VectorStore, type SearchHit } from "./store";
import { embedQuery } from "./embed";

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

/**
 * The query half of RAG: embed the query, vector-search a wide candidate set,
 * rerank, and keep the top-k. Retrieving wide then reranking narrow is what gives
 * the reranker something to improve on.
 */
export async function retrieve(
  store: VectorStore,
  query: string,
  opts: { k?: number; candidates?: number } = {},
): Promise<SearchHit[]> {
  const k = opts.k ?? 4;
  const candidates = opts.candidates ?? Math.max(k * 4, 12);
  const queryEmbedding = await embedQuery(query);
  const hits = store.search(queryEmbedding, candidates);
  return rerank(query, hits).slice(0, k);
}
