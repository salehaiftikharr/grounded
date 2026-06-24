# Grounded 🔎

A retrieval-augmented Q&A agent that **answers only from its corpus, cites its
sources, and refuses when the answer is not grounded.** Ask it something the
documents cover and it answers with citations; ask it something they do not and
it says so, instead of guessing.

The point of this project is the reliability layer most RAG demos skip. It guards
**both ends**: a **grounding gate** that decides whether retrieval is strong
enough to answer at all, and a **faithfulness check** that verifies the generated
answer against its sources and flags any claim the context does not support. An
**eval harness** grades retrieval quality, refusal discipline, *and* faithfulness.

```
$ npm run grounded ask "What does the grounding gate do?"

The grounding gate is a guardrail that runs before generation. It checks how many
chunks were retrieved and how strong the top similarity is, and refuses to answer
when retrieval is weak rather than producing an unsupported answer [1].

Sources:
  - grounding.md (score 0.71)

$ npm run grounded ask "What is the capital of France?"

I don't have enough grounded information in the corpus to answer that confidently.
```

## How it works

```
  corpus/*.md
      │  ingest:  read → chunk (overlapping) → embed → vector store
      ▼
  index.json  ──────────────────────────────────────────────┐
                                                              │
  question ──► embed ──► vector search (top-N) ──► rerank ──► top-k hits
                                                              │
                                              ┌───────────────┴───────────────┐
                                              │   grounding gate (input)       │
                                              │  strong enough to answer?      │
                                              └───────┬───────────────┬────────┘
                                                  yes │            no │
                                                      ▼               ▼
                                       cite-and-answer (LLM)      refuse
                                                      │
                                      ┌───────────────┴────────────────┐
                                      │  faithfulness check (output)    │
                                      │  is every claim supported?      │
                                      └───────────────┬─────────────────┘
                                                      ▼
                                      answer + per-claim verdicts + trace
```

- **Ingest** (`src/ingest.ts`, `src/chunk.ts`) — split docs into overlapping chunks, embed them, persist to a JSON vector store.
- **Retrieve** (`src/retrieve.ts`) — embed the query, vector-search a wide candidate set, then **rerank** by blending cosine score with lexical overlap (a cheap stand-in for a cross-encoder reranker, which slots in at the same seam).
- **Ground & answer** (`src/answer.ts`) — the **grounding gate** (`isGrounded`) checks hit count and top similarity; only if it passes does the LLM generate an answer constrained to the retrieved context, with inline citations.
- **Verify** (`src/faithfulness.ts`) — after generation, a separate fact-checking pass breaks the answer into individual claims and judges each against the retrieved context, returning a per-claim verdict and an overall faithfulness score. This catches the model drifting past its sources even when retrieval succeeded.
- **Observe** (`src/observe.ts`) — every request reports where the time went (retrieve / generate / verify) and how many tokens it cost, surfaced in the CLI and the web UI.

## Why two gates

A wrong answer delivered confidently is worse than an honest "I don't know,"
especially anywhere the output is trusted. There are two ways a RAG system gets
this wrong, so there are two gates:

- The **grounding gate** refuses when retrieval is too weak to answer — it would
  rather say nothing than fabricate.
- The **faithfulness check** flags when the answer outran its evidence — stating
  something the retrieved sources never actually say, even though retrieval
  succeeded.

Together they are the same "never ship the wrong thing" stance as a verification
gate in agent work, applied to both the input and the output of retrieval.

## Does it retrieve the right thing, refuse the rest, and stay faithful? The eval

`grounded eval` runs a labeled set (`src/eval/cases.ts`): in-corpus questions that
name the source that *should* be retrieved, and out-of-corpus questions that
*should* be refused (including an adversarial near-miss that shares the corpus's
vocabulary but is not covered). It reports retrieval hit-rate, refusal discipline,
and — with `--verify` — mean answer faithfulness.

```
$ npm run grounded eval

Retrieval hit-rate: 6/6 (100%)
Refused out-of-corpus correctly: 3/3
Accuracy: 9/9 (100%)
```

> The adversarial case is what raised the gate's threshold: it slipped in at a
> similarity of 0.344 while every genuine query scored 0.52+, so the gate moved to
> 0.40 to sit in that gap. The eval drove the fix.

## Run it

```bash
npm install
cp .env.example .env          # add OPENAI_API_KEY (embeddings) + ANTHROPIC_API_KEY (generation)

npm run grounded ingest            # index ./corpus into index.json
npm run grounded ask "What is reranking?"
npm run grounded eval
```

`npm test` runs the unit tests for the deterministic core (chunking, cosine
search, reranking, the grounding gate, faithfulness scoring, and token
accounting) — no API key needed.

## Web app

A Next.js UI (`app/`) makes the whole thing clickable: ask a question and see the
**answer with citations**, the **grounding-gate decision** (grounded vs. refused,
with the top similarity), a **claim check** marking each statement supported or
unsupported against the sources, a **retrieval panel** showing the exact chunks
that were pulled and their scores, and a **trace** of latency and token cost. Most
RAG demos hide the machinery; this one shows it.

```bash
npm run precompute     # build data/index.json from ./corpus (needs OPENAI_API_KEY)
npm run dev            # open http://localhost:3000
```

The API route retrieves and runs the grounding gate **locally** over the
committed index, so only the query embedding and the final answer call the model;
generation is IP-rate-limited to cap demo spend.

## Deploy (Vercel)

1. `npm run precompute` and commit the generated `data/index.json` (so the
   deployment ships with its index — no ingest at runtime).
2. Push and import the repo into Vercel.
3. Set env vars: `OPENAI_API_KEY` (embeddings) and `ANTHROPIC_API_KEY` (generation).
4. Deploy. Re-run `precompute` and re-commit whenever the corpus changes.

## Stack & production swap points

- **TypeScript + Next.js + Vercel AI SDK** (`ai`), provider seam in `src/lib/model.ts` — Claude or GPT for generation, OpenAI embeddings.
- **Vector store** is in-memory + JSON for a corpus this size; the `VectorStore` interface in `src/lib/store.ts` (`add` / `search` / `persist`) is the swap point for **pgvector / Pinecone / Weaviate**.
- **Reranker** is lexical-overlap today; the `rerank()` seam in `src/lib/retrieve.ts` is where a cross-encoder or LLM reranker drops in.

---

Built by [Saleha Iftikhar](https://saleha.live).
