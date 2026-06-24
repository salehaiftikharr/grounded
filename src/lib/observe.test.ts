import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage, sumUsage, ZERO_USAGE } from "./observe";

test("normalizeUsage reads the new AI SDK field names", () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }), {
    input: 10,
    output: 5,
    total: 15,
  });
});

test("normalizeUsage falls back to legacy prompt/completion names", () => {
  assert.deepEqual(normalizeUsage({ promptTokens: 7, completionTokens: 3 }), {
    input: 7,
    output: 3,
    total: 10,
  });
});

test("normalizeUsage is safe on null/undefined", () => {
  assert.deepEqual(normalizeUsage(undefined), ZERO_USAGE);
  assert.deepEqual(normalizeUsage(null), ZERO_USAGE);
});

test("sumUsage adds generation and verification usage", () => {
  const a = { input: 100, output: 40, total: 140 };
  const b = { input: 30, output: 12, total: 42 };
  assert.deepEqual(sumUsage(a, b), { input: 130, output: 52, total: 182 });
});

test("sumUsage of nothing is zero", () => {
  assert.deepEqual(sumUsage(), ZERO_USAGE);
});
