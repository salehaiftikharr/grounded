import type { NextRequest } from "next/server";
import { loadIndex } from "@/src/lib/loadIndex";
import { retrieve, retrieveFromSession } from "@/src/lib/retrieve";
import { answerQuestion } from "@/src/lib/answer";
import { timed } from "@/src/lib/observe";
import { readSessionId } from "@/src/lib/session";
import { sessionChunkCount } from "@/src/lib/db";

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

  // Pick the corpus: a visitor's uploaded document (namespaced by session) if
  // they have one, otherwise the built-in demo corpus. Reading the session count
  // is best-effort — if no database is configured we simply use the demo corpus,
  // so the default experience never depends on the upload feature.
  const sessionId = readSessionId(req);
  let uploadedCount = 0;
  if (sessionId) {
    uploadedCount = await sessionChunkCount(sessionId).catch(() => 0);
  }
  const usingUpload = uploadedCount > 0;

  let store: ReturnType<typeof loadIndex> | null = null;
  if (!usingUpload) {
    store = loadIndex();
    if (!store.size) {
      return Response.json(
        { error: "The index has not been built. Run `npm run precompute`." },
        { status: 503 },
      );
    }
  }

  const { result: retrieved, ms: retrieveMs } = await timed(() =>
    usingUpload
      ? retrieveFromSession(sessionId as string, question, { k: 4 })
      : retrieve(store!, question, { k: 4 }),
  );
  const { hits, candidateScores } = retrieved;
  const retrieval = hits.map((h) => ({
    source: h.chunk.source ?? h.chunk.id,
    score: Number(h.score.toFixed(3)),
    // Full (normalized) chunk text, capped — the UI highlights the supporting
    // span inside it, so it needs more than a 240-char teaser.
    snippet: h.chunk.text.replace(/\s+/g, " ").slice(0, 600),
  }));

  // verify: true runs the output-side faithfulness check after generation;
  // candidateScores feed the relative grounding gate.
  const result = await answerQuestion(question, hits, { verify: true, candidateScores });

  const f = result.faithfulness;

  return Response.json({
    grounded: result.grounded,
    corpus: usingUpload ? "upload" : "default",
    topScore: retrieval[0]?.score ?? 0,
    answer: result.text,
    citations: result.citations.map((c) => ({
      source: c.source ?? c.id,
      score: Number(c.score.toFixed(3)),
    })),
    retrieval,
    faithfulness: f
      ? {
          verdict: f.verdict,
          score: Number(f.score.toFixed(2)),
          claims: f.claims,
          unsupported: f.unsupported,
        }
      : null,
    timings: {
      retrieveMs,
      generateMs: result.timings.generateMs,
      verifyMs: result.timings.verifyMs,
      totalMs: retrieveMs + result.timings.generateMs + result.timings.verifyMs,
    },
    usage: result.usage,
  });
}
