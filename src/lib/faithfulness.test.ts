import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, type ClaimCheck } from "./faithfulness";

const claim = (supported: boolean, text = "c"): ClaimCheck => ({
  claim: text,
  supported,
  evidence: supported ? "quote" : "",
});

test("all claims supported → verdict supported, score 1", () => {
  const { verdict, score, unsupported } = summarize([claim(true), claim(true)]);
  assert.equal(verdict, "supported");
  assert.equal(score, 1);
  assert.deepEqual(unsupported, []);
});

test("some claims unsupported → verdict partial", () => {
  const { verdict, score, unsupported } = summarize([claim(true), claim(true), claim(false, "bad")]);
  assert.equal(verdict, "partial");
  assert.ok(Math.abs(score - 2 / 3) < 1e-9);
  assert.deepEqual(unsupported, ["bad"]);
});

test("majority unsupported → verdict unsupported", () => {
  const { verdict, score } = summarize([claim(false, "a"), claim(false, "b"), claim(true)]);
  assert.equal(verdict, "unsupported");
  assert.ok(Math.abs(score - 1 / 3) < 1e-9);
});

test("exactly half supported is still partial, not unsupported", () => {
  const { verdict } = summarize([claim(true), claim(false, "x")]);
  assert.equal(verdict, "partial");
});

test("no claims → skipped and treated as faithful", () => {
  const { verdict, score, unsupported } = summarize([]);
  assert.equal(verdict, "skipped");
  assert.equal(score, 1);
  assert.deepEqual(unsupported, []);
});
