import { test } from "node:test";
import assert from "node:assert/strict";
import { queryTerms, rerank } from "./retrieve";
import type { SearchHit } from "./store";

test("queryTerms lowercases, drops short tokens, and dedupes", () => {
  const terms = queryTerms("How does Cosine cosine similarity WORK?");
  assert.ok(terms.includes("cosine"));
  assert.ok(terms.includes("similarity"));
  assert.ok(terms.includes("how"));
  assert.ok(!terms.includes("?"));
  assert.equal(terms.filter((t) => t === "cosine").length, 1);
});

const hit = (id: string, text: string, score: number): SearchHit => ({
  chunk: { id, docId: id, text, embedding: [] },
  score,
});

test("rerank promotes a lexically-overlapping chunk above a slightly closer but unrelated one", () => {
  const hits: SearchHit[] = [
    hit("unrelated", "content about cooking recipes and dinner", 0.52),
    hit("relevant", "cosine similarity ranks chunks during retrieval", 0.5),
  ];
  const reranked = rerank("how does cosine similarity work", hits, 0.2);
  assert.equal(reranked[0].chunk.id, "relevant");
});

test("rerank with no usable query terms returns the hits unchanged", () => {
  const hits = [hit("a", "alpha", 0.4), hit("b", "beta", 0.3)];
  const reranked = rerank("?? a", hits);
  assert.equal(reranked[0].chunk.id, "a");
});
