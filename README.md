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
- **Verify** (`src/faithfulness.ts`) — after generation, a separate fact-checking pass breaks the answer into individual claims and judges each against the retrieved context. This catches the model drifting past its sources even when retrieval succeeded. Three things keep the check from rubber-stamping: the checker is a **different model** from the generator (shared weights share blind spots); it is prompted **adversarially** (assume unsupported until proven); and — most importantly — each supporting quote is **mechanically verified to be an actual substring of a retrieved chunk**. A claim only counts as supported if its quote provably exists, so the signal is "a model pointed at text that is really there," not "a model agreed." That substring match is also what locates the exact sentence the UI highlights.
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

**What faithfulness does and does not mean.** The check measures whether the
answer is faithful to the *retrieved evidence* — not whether it is *true*. If
retrieval surfaces a chunk that is similar but wrong, an answer can be perfectly
faithful to it and still false. Faithfulness assumes the grounding gate and the
corpus did their job; it is a guard against the model, not against bad sources.

## The eval (a regression set, not a benchmark)

`grounded eval` runs a **small, labeled regression set** (`src/eval/cases.ts`).
With this few cases the pass rate is a smoke test, not a statistic — the value is
catching regressions and the **adversarial near-misses**: questions that borrow the
corpus's vocabulary but ask about things it never covers. It reports retrieval
hit-rate, refusal discipline, and — with `--verify` — mean answer faithfulness.

```
$ npm run grounded eval

Retrieval hit-rate: 12/12 (100%)
Refused clear out-of-corpus: 2/2
Refused adversarial near-miss (gate alone): 3/4
  note: this leak is caught at GENERATION, not by the faithfulness gate
  (see the honest accounting below).

✓ PASS (retrieval hits + clear refusals)
```

Two things this surfaced, both kept honestly rather than tuned away:

- **The eval drives the gate.** An early adversarial case slipped past an absolute
  cosine threshold, which motivated moving to a **relative** gate (a hit must stand
  out from the query's own candidate-score distribution, not clear a fixed value
  that does not transfer across corpora), with a low absolute floor as a backstop.
- **One near-miss still passes the gate** ("which vector database is fastest at
  billion-scale search?") because it shares too much vocabulary with the retrieval
  doc — "distinctive" is not "relevant." Being precise about what catches it: the
  **generator** answers "I do not know" from the vocab-similar chunks. That is the
  generator's own discretion — the very LLM-judgment this system tries not to lean
  on — *not* the faithfulness gate, which never fires because no claim is produced
  to check. So this case demonstrates the generator behaving well, not the second
  gate working. The faithfulness gate's real guarantee is shown elsewhere: the
  mechanical quote check drops any claim whose evidence is not a verbatim substring
  of a source, regardless of what the checker model says.

**Where the relative gate is weak (known, not hidden).** It assumes a real match
*stands out* from the candidate distribution, which breaks in two common cases:
**near-duplicate chunks** (boilerplate, repeated headers) mean even a perfect match
does not stand out, causing false refusals; and a **semantically narrow corpus**
(everything similar) flattens the distribution the same way. In both, the absolute
floor is doing the load-bearing work, and the relative term mainly helps the
"everything is weak but one is weakly-best" regime. It is a real improvement for
cross-corpus transfer, not a universal fix.

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
- **Decorrelated checker** — the faithfulness checker defaults to a smaller, faster model than the generator; set `CHECKER_PROVIDER=openai` (or `CHECKER_MODEL`) to verify with a different model *family* entirely.
- **Grounding gate** is relative (z-score over the candidate distribution) plus an absolute floor, in `src/lib/answer.ts`; tune `minMargin` / `minTopScore` per corpus.
- **Vector store** is in-memory + JSON for a corpus this size; the `VectorStore` interface in `src/lib/store.ts` (`add` / `search` / `persist`) is the swap point for **pgvector / Pinecone / Weaviate**.
- **Reranker** is lexical-overlap today; the `rerank()` seam in `src/lib/retrieve.ts` is where a cross-encoder or LLM reranker drops in.

---

Built by [Saleha Iftikhar](https://saleha.live).
