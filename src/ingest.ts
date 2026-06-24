import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chunkText, type RawDoc } from "./chunk";
import { embedTexts } from "./embed";
import { VectorStore } from "./store";

/**
 * Ingest a directory of .md/.txt files into a vector store: read → chunk →
 * embed → store. This is the indexing half of RAG; `retrieve` is the query half.
 */
export async function ingestDir(
  dir: string,
  opts: { size?: number; overlap?: number; onLog?: (m: string) => void } = {},
): Promise<VectorStore> {
  const log = opts.onLog ?? (() => {});
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  if (!files.length) throw new Error(`No .md or .txt files found in ${dir}`);

  const docs: RawDoc[] = files.map((f) => ({
    id: f,
    source: f,
    text: readFileSync(path.join(dir, f), "utf8"),
  }));
  const chunks = docs.flatMap((d) => chunkText(d, { size: opts.size, overlap: opts.overlap }));
  log(`${docs.length} doc(s) → ${chunks.length} chunk(s); embedding…`);

  const embeddings = await embedTexts(chunks.map((c) => c.text));
  const store = new VectorStore();
  store.add(chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })));
  return store;
}
