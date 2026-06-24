import type { NextRequest } from "next/server";
import { loadIndex } from "@/src/lib/loadIndex";
import { retrieve } from "@/src/lib/retrieve";
import { answerQuestion, isGrounded } from "@/src/lib/answer";

// Needs node:fs to read the committed index.
export const runtime = "nodejs";

// Naive per-instance IP rate limit — enough to cap demo spend. A production
// deploy would back this with Upstash/Vercel KV for a shared, durable counter.
const buckets = new Map<string, { count: number; reset: number }>();
const LIMIT = 8;
const WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.reset) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LIMIT;
}

export async function POST(req: NextRequest): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return Response.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > 500) {
    return Response.json({ error: "Question is too long." }, { status: 400 });
  }
  if (rateLimited(ip)) {
    return Response.json(
      { error: "Hourly demo limit reached. Try again later." },
      { status: 429 },
    );
  }

  const store = loadIndex();
  if (!store.size) {
    return Response.json(
      { error: "The index has not been built. Run `npm run precompute`." },
      { status: 503 },
    );
  }

  const hits = await retrieve(store, question, { k: 4 });
  const retrieval = hits.map((h) => ({
    source: h.chunk.source ?? h.chunk.id,
    score: Number(h.score.toFixed(3)),
    snippet: h.chunk.text.replace(/\s+/g, " ").slice(0, 240),
  }));

  const result = await answerQuestion(question, hits);

  return Response.json({
    grounded: result.grounded,
    topScore: retrieval[0]?.score ?? 0,
    answer: result.text,
    citations: result.citations.map((c) => ({
      source: c.source ?? c.id,
      score: Number(c.score.toFixed(3)),
    })),
    retrieval,
  });
}
