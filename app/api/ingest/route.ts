import type { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkText, type RawDoc } from "@/src/lib/chunk";
import { embedTexts } from "@/src/lib/embed";
import { replaceSessionChunks, sessionSources, cleanupExpired, type IngestChunk } from "@/src/lib/db";
import { readSessionId, newSessionId, sessionCookie } from "@/src/lib/session";

// Needs node APIs (crypto, pdf parsing) and the Postgres client.
export const runtime = "nodejs";
export const maxDuration = 60;

// Cost guards: embedding uploads spends real credits on a public URL, so cap
// how much a single upload can cost and how often anyone can upload.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB file ceiling
const MAX_CHARS = 120_000; // extracted-text ceiling (~30k tokens)
const MAX_CHUNKS = 150; // hard cap on chunks embedded per upload
const INGEST_LIMIT = 5; // uploads per IP per hour
const WINDOW_MS = 60 * 60 * 1000;

const buckets = new Map<string, { count: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > INGEST_LIMIT;
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/** Pull raw text out of an uploaded file by extension. */
async function extractDocText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return await file.text();
  }
  throw new Error("Unsupported file type. Upload a .pdf, .txt, or .md file.");
}

export async function POST(req: NextRequest): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  }

  // Accept a file upload and/or a pasted-text field via multipart form data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected a file upload or pasted text." }, { status: 400 });
  }

  const file = form.get("file");
  const pasted = form.get("text");

  let text: string;
  let source: string;
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return json({ error: "File is too large (4 MB max)." }, { status: 413 });
      }
      text = await extractDocText(file);
      source = file.name;
    } else if (typeof pasted === "string" && pasted.trim()) {
      text = pasted;
      source = "pasted text";
    } else {
      return json({ error: "Upload a .pdf, .txt, or .md file, or paste some text." }, { status: 400 });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not read the document." }, { status: 400 });
  }

  text = text.replace(/\s+\n/g, "\n").trim();
  if (!text) {
    return json({ error: "No readable text found in that document." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
  }

  const doc: RawDoc = { id: source, source, text };
  let chunks = chunkText(doc);
  if (!chunks.length) {
    return json({ error: "That document did not produce any usable text." }, { status: 400 });
  }
  const truncated = chunks.length > MAX_CHUNKS;
  if (truncated) chunks = chunks.slice(0, MAX_CHUNKS);

  // Establish (or reuse) the anonymous session that owns this corpus.
  const sessionId = readSessionId(req) ?? newSessionId();

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks.map((c) => c.text));
  } catch {
    return json({ error: "Could not embed the document. Try again." }, { status: 502 });
  }

  const ingestChunks: IngestChunk[] = chunks.map((c, i) => ({
    id: `${sessionId}:${c.id}`,
    docId: c.docId,
    source: c.source,
    text: c.text,
    embedding: embeddings[i],
  }));

  try {
    await replaceSessionChunks(sessionId, ingestChunks);
    await cleanupExpired();
  } catch {
    return json({ error: "Could not save the document. Is the database configured?" }, { status: 503 });
  }

  const sources = await sessionSources(sessionId).catch(() => [source]);
  const res = json({
    ok: true,
    source,
    chunks: ingestChunks.length,
    truncated,
    sources,
  });
  res.headers.set("Set-Cookie", sessionCookie(sessionId));
  return res;
}

/** Status: which uploaded corpus (if any) is active for this session. */
export async function GET(req: NextRequest): Promise<Response> {
  const sessionId = readSessionId(req);
  if (!sessionId) return json({ active: false, sources: [] });
  try {
    const sources = await sessionSources(sessionId);
    return json({ active: sources.length > 0, sources });
  } catch {
    // No database configured — the default corpus is the only option.
    return json({ active: false, sources: [] });
  }
}

/** Reset: drop this session's uploaded corpus and fall back to the demo corpus. */
export async function DELETE(req: NextRequest): Promise<Response> {
  const sessionId = readSessionId(req);
  if (sessionId) {
    const { clearSession } = await import("@/src/lib/db");
    await clearSession(sessionId).catch(() => {});
  }
  return json({ ok: true });
}
