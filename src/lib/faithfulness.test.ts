import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, locateEvidence, normalizeForMatch, type ClaimCheck } from "./faithfulness";

const claim = (supported: boolean, evidenceLocated: boolean, text = "c"): ClaimCheck => ({
  claim: text,
  supported,
  evidence: supported ? "quote" : "",
  evidenceLocated,
  sourceIndex: evidenceLocated ? 1 : null,
});

test("a claim counts only when supported AND its quote was located", () => {
  const { verdict, score, unsupported } = summarize([claim(true, true), claim(true, true)]);
  assert.equal(verdict, "supported");
  assert.equal(score, 1);
  assert.deepEqual(unsupported, []);
});

test("model says supported but quote not located → claim is dropped (hallucinated evidence)", () => {
  // This is the mechanical guarantee: the model's word alone is not enough.
  const { verdict, score, unsupported } = summarize([claim(true, true), claim(true, false, "ghost")]);
  assert.equal(verdict, "partial");
  assert.equal(score, 0.5);
  assert.deepEqual(unsupported, ["ghost"]);
});

test("majority unverified → verdict unsupported", () => {
  const { verdict } = summarize([claim(false, false, "a"), claim(true, false, "b"), claim(true, true)]);
  assert.equal(verdict, "unsupported");
});

test("no claims → skipped and treated as faithful", () => {
  const { verdict, score, unsupported } = summarize([]);
  assert.equal(verdict, "skipped");
  assert.equal(score, 1);
  assert.deepEqual(unsupported, []);
});

test("locateEvidence finds a verbatim quote and returns its 1-based chunk index", () => {
  const chunks = ["The grounding gate runs before generation.", "Reranking blends scores."];
  assert.equal(locateEvidence("runs before generation", chunks), 1);
  assert.equal(locateEvidence("Reranking blends", chunks), 2);
});

test("locateEvidence is forgiving about case, whitespace, and punctuation", () => {
  const chunks = ["Overlap preserves context across the seam, so a fact survives."];
  assert.equal(locateEvidence("Overlap   preserves CONTEXT across the seam", chunks), 1);
});

test("locateEvidence returns null for a quote that is not present (hallucinated)", () => {
  const chunks = ["The grounding gate runs before generation."];
  assert.equal(locateEvidence("cosine similarity uses the dot product", chunks), null);
});

test("locateEvidence rejects too-short quotes as not real evidence", () => {
  assert.equal(locateEvidence("the", ["the grounding gate"]), null);
});

test("normalizeForMatch lowercases, strips punctuation, and collapses whitespace", () => {
  assert.equal(normalizeForMatch("  The  Gate, runs!  "), "the gate runs");
});
