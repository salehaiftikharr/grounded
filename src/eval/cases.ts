/**
 * Labeled eval cases. In-corpus questions name the source file that should be
 * retrieved; out-of-corpus questions (expectSource: null) MUST be refused by the
 * grounding gate — answering them at all is the failure.
 */
export interface EvalCase {
  question: string;
  expectSource: string | null;
}

export const cases: EvalCase[] = [
  { question: "What is chunking and why does overlap between chunks matter?", expectSource: "chunking.md" },
  { question: "How does cosine similarity rank chunks during retrieval?", expectSource: "embeddings.md" },
  { question: "What does the grounding gate do and why does it matter?", expectSource: "grounding.md" },
  { question: "What is reranking and how does it improve retrieval?", expectSource: "retrieval.md" },
  { question: "What is the capital of France?", expectSource: null },
  { question: "Who won the 2018 FIFA World Cup?", expectSource: null },
];
