/**
 * Chunking: split a document into overlapping, coherent pieces for retrieval.
 *
 * We split on paragraph boundaries first so a chunk stays readable, then pack
 * paragraphs into windows of ~`size` characters. Between windows we carry an
 * `overlap` tail so a fact that straddles a boundary is still retrievable. A
 * single oversized paragraph is hard-split as a fallback.
 */

export interface RawDoc {
  id: string;
  text: string;
  source?: string;
}

export interface Chunk {
  id: string;
  docId: string;
  index: number;
  text: string;
  source?: string;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export function chunkText(doc: RawDoc, opts: ChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 900;
  const overlap = Math.min(opts.overlap ?? 150, Math.floor(size / 2));
  const paragraphs = doc.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buf = "";

  const flush = () => {
    const text = buf.trim();
    if (!text) return;
    chunks.push({
      id: `${doc.id}#${chunks.length}`,
      docId: doc.id,
      index: chunks.length,
      text,
      source: doc.source,
    });
    // Seed the next window with the overlap tail of this one.
    buf = overlap > 0 ? text.slice(-overlap) : "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      // Oversized paragraph: emit what we have, then hard-split it.
      flush();
      buf = "";
      for (let i = 0; i < paragraph.length; i += size - overlap) {
        buf = paragraph.slice(i, i + size);
        flush();
      }
      buf = "";
      continue;
    }
    if (buf && buf.length + paragraph.length + 2 > size) flush();
    buf += (buf ? "\n\n" : "") + paragraph;
  }
  flush();

  return chunks;
}
