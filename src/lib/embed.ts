import { embed, embedMany } from "ai";
import { getEmbeddingModel } from "./model";

/** Embed many texts at once (used when indexing the corpus). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: getEmbeddingModel(), values: texts });
  return embeddings;
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: getEmbeddingModel(), value: text });
  return embedding;
}
