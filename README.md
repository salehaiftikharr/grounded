# grounded-rag 🔎

A retrieval-augmented Q&A agent that **answers only from its corpus, cites its
sources, and refuses when the answer is not grounded.** Ask it something the
documents cover and it answers with citations; ask it something they do not and
it says so, instead of guessing.

The point of this project is the reliability layer most RAG demos skip: a
**grounding gate** that decides whether retrieval is strong enough to answer at
all, and an **eval harness** that grades retrieval quality *and* that discipline.

```
$ npm run rag ask "What does the grounding gate do?"

The grounding gate is a guardrail that runs before generation. It checks how many
chunks were retrieved and how strong the top similarity is, and refuses to answer
when retrieval is weak rather than producing an unsupported answer [1].

Sources:
  - grounding.md (score 0.71)

$ npm run rag ask "What is the capital of France?"

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
                                              │        grounding gate          │
                                              │  strong enough to answer?      │
                                              └───────┬───────────────┬────────┘
                                                  yes │            no │
                                                      ▼               ▼
                                       cite-and-answer (LLM)      refuse
```

- **Ingest** (`src/ingest.ts`, `src/chunk.ts`) — split docs into overlapping chunks, embed them, persist to a JSON vector store.
- **Retrieve** (`src/retrieve.ts`) — embed the query, vector-search a wide candidate set, then **rerank** by blending cosine score with lexical overlap (a cheap stand-in for a cross-encoder reranker, which slots in at the same seam).
- **Ground & answer** (`src/answer.ts`) — the **grounding gate** (`isGrounded`) checks hit count and top similarity; only if it passes does the LLM generate an answer constrained to the retrieved context, with inline citations.

## Why grounding is the point

A wrong answer delivered confidently is worse than an honest "I don't know,"
especially anywhere the output is trusted. The grounding gate is the same
"never ship the wrong thing" stance as a verification gate in agent work, applied
to retrieval: the system would rather refuse than fabricate.

## Does it actually retrieve the right thing — and refuse the rest? The eval

`rag eval` runs a labeled set (`src/eval/cases.ts`): in-corpus questions that
name the source that *should* be retrieved, and out-of-corpus questions that
*should* be refused. It reports retrieval hit-rate and refusal discipline.

```
$ npm run rag eval

Retrieval hit-rate: 4/4 (100%)
Refused out-of-corpus correctly: 2/2
Accuracy: 6/6 (100%)
```

## Run it

```bash
npm install
cp .env.example .env          # add OPENAI_API_KEY (embeddings) + ANTHROPIC_API_KEY (generation)

npm run rag ingest            # index ./corpus into index.json
npm run rag ask "What is reranking?"
npm run rag eval
```

`npm test` runs the unit tests for the deterministic core (chunking, cosine
search, reranking, and the grounding gate) — no API key needed.

## Stack & production swap points

- **TypeScript + Vercel AI SDK** (`ai`), provider seam in `src/model.ts` — Claude or GPT for generation, OpenAI embeddings.
- **Vector store** is in-memory + JSON for a corpus this size; the `VectorStore` interface (`add` / `search` / `persist`) is the swap point for **pgvector / Pinecone / Weaviate**.
- **Reranker** is lexical-overlap today; the `rerank()` seam is where a cross-encoder or LLM reranker drops in.

---

Built by [Saleha Iftikhar](https://saleha.live).
