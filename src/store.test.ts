import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, VectorStore, type StoredChunk } from "./store";

test("cosine similarity: identical, orthogonal, opposite, and zero vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

const chunk = (id: string, embedding: number[]): StoredChunk => ({
  id,
  docId: id,
  text: id,
  embedding,
});

test("search returns the top-k chunks sorted by similarity", () => {
  const store = new VectorStore();
  store.add([
    chunk("near", [1, 0]),
    chunk("mid", [0.7, 0.7]),
    chunk("far", [0, 1]),
  ]);
  const hits = store.search([1, 0], 2);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].chunk.id, "near");
  assert.equal(hits[1].chunk.id, "mid");
  assert.ok(hits[0].score >= hits[1].score);
});
