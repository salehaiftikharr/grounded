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
      // Oversized paragraph: emit what we have, then split it on sentence
      // boundaries so each fact stays intact and retrievable, rather than
      // cutting mid-sentence. A single sentence longer than the window is the
      // only case that still gets a hard character split.
      flush();
      buf = "";
      for (const piece of splitOnSentences(paragraph, size, overlap)) {
        buf = piece;
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

/** Break a run of text into sentences, keeping the terminal punctuation. */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [text];
}

/**
 * Pack a long paragraph into <=size windows on sentence boundaries, carrying an
 * `overlap` tail between windows. A lone sentence longer than the window is hard
 * character-split as a last resort.
 */
function splitOnSentences(paragraph: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = overlap > 0 && t ? t.slice(-overlap) : "";
  };
  for (const sentence of splitSentences(paragraph)) {
    if (sentence.length > size) {
      push();
      cur = "";
      for (let i = 0; i < sentence.length; i += Math.max(1, size - overlap)) {
        out.push(sentence.slice(i, i + size));
      }
      continue;
    }
    if (cur && cur.length + sentence.length + 1 > size) push();
    cur += (cur ? " " : "") + sentence;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}
