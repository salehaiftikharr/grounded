import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { VectorStore, type StoredChunk } from "./store";

/**
 * Load the precomputed corpus index for the web app. The index is built once
 * with `npm run precompute` (which needs an embeddings key) and committed to
 * data/index.json, so serving it at request time costs nothing — only the
 * query embedding and the final generation hit the API. Cached per process.
 */
let cached: VectorStore | null = null;

export function loadIndex(): VectorStore {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "index.json");
  const store = new VectorStore();
  if (existsSync(file)) {
    const data = JSON.parse(readFileSync(file, "utf8")) as { chunks: StoredChunk[] };
    store.chunks = data.chunks ?? [];
  }
  cached = store;
  return store;
}
