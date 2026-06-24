import { test } from "node:test";
import assert from "node:assert/strict";
import { isGrounded, DEFAULT_POLICY, type GroundingPolicy } from "./answer";
import type { SearchHit } from "./store";

const hit = (score: number): SearchHit => ({
  chunk: { id: "c", docId: "c", text: "c", embedding: [] },
  score,
});

// A candidate distribution where the top clearly stands out (z ≈ 2.2).
const STANDS_OUT = [0.6, 0.25, 0.2, 0.18, 0.15, 0.12];
// A flat pile: several candidates bunched near the top, so the top barely rises
// above the mean (z ≈ 0.65) even though it clears the absolute floor.
const FLAT = [0.62, 0.61, 0.61, 0.6, 0.6, 0.45];

test("grounding gate refuses when there are no hits", () => {
  assert.equal(isGrounded([], STANDS_OUT), false);
});

test("grounding gate refuses when the top score is below the absolute floor", () => {
  assert.equal(isGrounded([hit(0.1)], STANDS_OUT), false);
  assert.equal(isGrounded([hit(DEFAULT_POLICY.minTopScore - 0.01)], STANDS_OUT), false);
});

test("grounding gate allows an answer when the top clears the floor and stands out", () => {
  assert.equal(isGrounded([hit(0.6), hit(0.25)], STANDS_OUT), true);
});

test("relative margin refuses a top hit that does not stand out from a high, flat pile", () => {
  // 0.62 clears the absolute floor, but it is just the tallest of a uniform pile,
  // so the relative test (z-score) refuses it — the case a fixed floor misses.
  assert.equal(isGrounded([hit(0.62)], FLAT), false);
});

test("minMargin = 0 disables the relative test, falling back to the floor only", () => {
  const floorOnly: GroundingPolicy = { ...DEFAULT_POLICY, minMargin: 0 };
  assert.equal(isGrounded([hit(0.62)], FLAT, floorOnly), true);
});

test("with too few candidates to form a distribution, the floor governs", () => {
  assert.equal(isGrounded([hit(0.62)], [0.62, 0.6], DEFAULT_POLICY), true);
});

test("a stricter policy raises the bar", () => {
  const strict: GroundingPolicy = { minTopScore: 0.7, minHits: 1, minMargin: 1.0 };
  assert.equal(isGrounded([hit(0.6)], STANDS_OUT, strict), false);
});
