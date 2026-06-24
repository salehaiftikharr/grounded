import { test } from "node:test";
import assert from "node:assert/strict";
import { isGrounded, DEFAULT_POLICY } from "./answer";
import type { SearchHit } from "./store";

const hit = (score: number): SearchHit => ({
  chunk: { id: "c", docId: "c", text: "c", embedding: [] },
  score,
});

test("grounding gate refuses when there are no hits", () => {
  assert.equal(isGrounded([]), false);
});

test("grounding gate refuses when the top score is below the threshold", () => {
  assert.equal(isGrounded([hit(0.1)]), false);
  assert.equal(isGrounded([hit(DEFAULT_POLICY.minTopScore - 0.01)]), false);
});

test("grounding gate allows an answer when retrieval is strong enough", () => {
  assert.equal(isGrounded([hit(0.5), hit(0.4)]), true);
  assert.equal(isGrounded([hit(DEFAULT_POLICY.minTopScore)]), true);
});

test("a stricter policy raises the bar", () => {
  assert.equal(isGrounded([hit(0.4)], { minTopScore: 0.6, minHits: 1 }), false);
  assert.equal(isGrounded([hit(0.4)], { minTopScore: 0.6, minHits: 2 }), false);
});
