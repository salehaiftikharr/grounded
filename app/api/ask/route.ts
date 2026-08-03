import type { NextRequest } from "next/server";
import { streamText } from "ai";
import { loadIndex } from "@/src/lib/loadIndex";
import { retrieve, retrieveFromSession } from "@/src/lib/retrieve";
import {
  REFUSAL,
  UPLOAD_POLICY,
  answerSystemPrompt,
  answerPrompt,
  buildContext,
  isAnswerable,
  isOverviewQuestion,
  topMargin,
} from "@/src/lib/answer";
import { getChatModel } from "@/src/lib/model";
import { verifyFaithfulness } from "@/src/lib/faithfulness";
import { normalizeUsage, sumUsage, ZERO_USAGE } from "@/src/lib/observe";
import { readSessionId } from "@/src/lib/session";
import { sessionChunkCount } from "@/src/lib/db";

// Needs node:fs to read the committed index.
export const runtime = "nodejs";
// Retrieval, generation, and the faithfulness pass are three model calls in
// sequence, so the request can run close to ten seconds. Give it headroom well
// past the default so a slow model call never turns into a gateway timeout.
export const maxDuration = 60;

// Naive per-instance IP rate limit — enough to cap demo spend. A production
// deploy would back this with Upstash/Vercel KV for a shared, durable counter.
const buckets = new Map<string, { count: number; reset: number }>();
const LIMIT = 30;
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
      { error: "You have hit the hourly demo limit. Please try again in a bit." },
      { status: 429 },
    );
  }

  // Pick the corpus: a visitor's uploaded document (namespaced by session) if they
  // have one, otherwise the built-in demo corpus. Best-effort — a missing database
  // just means the default corpus is used.
  const sessionId = readSessionId(req);
  let uploadedCount = 0;
  if (sessionId) {
    uploadedCount = await sessionChunkCount(sessionId).catch(() => 0);
  }
  const usingUpload = uploadedCount > 0;

  // Load (and sanity-check) the default index before opening the stream, so a
  // missing index is a clean up-front error rather than a broken stream.
  let store: ReturnType<typeof loadIndex> | null = null;
  if (!usingUpload) {
    try {
      store = loadIndex();
    } catch {
      store = null;
    }
    if (!store || !store.size) {
      return Response.json(
        { error: "The index has not been built. Run `npm run precompute`." },
        { status: 503 },
      );
    }
  }

  // Stream the whole pipeline as newline-delimited JSON events so the UI can show
  // the gate decision and sources immediately, then the answer as it generates,
  // then the faithfulness verdict once the checker returns.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const overview = isOverviewQuestion(question);
        const k = overview ? 8 : 4;

        const tRetrieve = Date.now();
        const { hits, candidateScores } = usingUpload
          ? await retrieveFromSession(sessionId as string, question, { k })
          : await retrieve(store!, question, { k });
        const retrieveMs = Date.now() - tRetrieve;

        const retrieval = hits.map((h) => ({
          source: h.chunk.source ?? h.chunk.id,
          score: Number(h.score.toFixed(3)),
          snippet: h.chunk.text.replace(/\s+/g, " ").slice(0, 600),
        }));
        const citations = hits.map((h) => ({
          source: h.chunk.source ?? h.chunk.id,
          score: Number(h.score.toFixed(3)),
        }));

        // Uploaded corpora use a more permissive, single-topic-aware policy.
        const grounded = isAnswerable(
          hits,
          candidateScores,
          overview,
          usingUpload ? UPLOAD_POLICY : undefined,
        );

        // The gate decision and sources go out first, before any generation.
        send({
          type: "meta",
          grounded,
          corpus: usingUpload ? "upload" : "default",
          topScore: retrieval[0]?.score ?? 0,
          margin: overview ? null : topMargin(hits[0]?.score ?? 0, candidateScores),
          overview,
          retrieval,
          citations,
        });

        if (!grounded) {
          send({ type: "delta", text: REFUSAL });
          send({
            type: "done",
            faithfulness: null,
            timings: { retrieveMs, generateMs: 0, verifyMs: 0, totalMs: retrieveMs },
            usage: { ...ZERO_USAGE },
          });
          controller.close();
          return;
        }

        // Stream the grounded answer token by token.
        const tGen = Date.now();
        const gen = streamText({
          model: getChatModel(),
          system: answerSystemPrompt(overview),
          prompt: answerPrompt(buildContext(hits), question),
        });
        let fullText = "";
        for await (const delta of gen.textStream) {
          fullText += delta;
          send({ type: "delta", text: delta });
        }
        const generateMs = Date.now() - tGen;
        const genUsage = normalizeUsage(await gen.usage);
        send({ type: "generated" });

        // Output-side faithfulness check on the complete answer.
        const tVerify = Date.now();
        const faith = await verifyFaithfulness(fullText, hits);
        const verifyMs = Date.now() - tVerify;
        send({
          type: "faithfulness",
          faithfulness: {
            verdict: faith.verdict,
            score: Number(faith.score.toFixed(2)),
            claims: faith.claims,
            unsupported: faith.unsupported,
          },
        });

        send({
          type: "done",
          timings: {
            retrieveMs,
            generateMs,
            verifyMs,
            totalMs: retrieveMs + generateMs + verifyMs,
          },
          usage: sumUsage(genUsage, faith.usage),
        });
        controller.close();
      } catch (err) {
        console.error("ask stream failed:", err);
        try {
          send({
            type: "error",
            error:
              "Something went wrong reaching the model or a data source. This is usually temporary, so please try again.",
          });
        } catch {}
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
