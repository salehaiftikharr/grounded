import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * A minimal vector store: chunks plus their embeddings, with cosine-similarity
 * search. In-memory and JSON-persisted, which is plenty for a corpus this size.
 * The interface (add / search / persist / load) is the swap point: a production
 * build would back `search` with pgvector or Pinecone and keep everything else.
 */

export interface StoredChunk {
  id: string;
  docId: string;
  text: string;
  source?: string;
  embedding: number[];
}

export interface SearchHit {
  chunk: StoredChunk;
  score: number;
}

/** Cosine similarity of two equal-length vectors, in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  chunks: StoredChunk[] = [];

  add(chunks: StoredChunk[]): void {
    this.chunks.push(...chunks);
  }

  get size(): number {
    return this.chunks.length;
  }

  /** Top-k chunks by cosine similarity to the query embedding. */
  search(query: number[], k = 5): SearchHit[] {
    return this.chunks
      .map((chunk) => ({ chunk, score: cosineSimilarity(query, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  persist(file: string): void {
    writeFileSync(file, JSON.stringify({ chunks: this.chunks }));
  }

  static load(file: string): VectorStore {
    const store = new VectorStore();
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as { chunks: StoredChunk[] };
      store.chunks = data.chunks ?? [];
    }
    return store;
  }
}
