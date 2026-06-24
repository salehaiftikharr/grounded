import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./chunk";

test("a short document becomes a single chunk", () => {
  const chunks = chunkText({ id: "a.md", source: "a.md", text: "One short paragraph." });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].docId, "a.md");
  assert.equal(chunks[0].source, "a.md");
  assert.equal(chunks[0].index, 0);
  assert.match(chunks[0].id, /^a\.md#0$/);
});

test("a long document splits into multiple, sequentially-indexed chunks", () => {
  const para = "word ".repeat(60).trim(); // ~300 chars
  const text = Array.from({ length: 8 }, () => para).join("\n\n"); // ~2400 chars
  const chunks = chunkText({ id: "long.md", text }, { size: 500, overlap: 80 });

  assert.ok(chunks.length > 1, "should produce multiple chunks");
  chunks.forEach((c, i) => assert.equal(c.index, i));
  // No chunk should be wildly over the window (allow overlap slack).
  for (const c of chunks) assert.ok(c.text.length <= 500 + 80 + 5);
});

test("an oversized single paragraph is hard-split", () => {
  const text = "x".repeat(1500);
  const chunks = chunkText({ id: "big.md", text }, { size: 400, overlap: 50 });
  assert.ok(chunks.length >= 3);
});
