/**
 * A small, labeled regression set — not a benchmark. With this few cases the pass
 * rate is a smoke test, not a statistic; the value is catching regressions and the
 * adversarial near-misses below, not the headline percentage. Grow the corpus and
 * this set together before reading much into the numbers.
 *
 * In-corpus questions name the source file that should be retrieved. Out-of-corpus
 * questions (expectSource: null) MUST be refused by the grounding gate — answering
 * them at all is the failure that matters.
 */
export interface EvalCase {
  question: string;
  expectSource: string | null;
  /** Marks a question that is topically adjacent to the corpus but not covered. */
  adversarial?: boolean;
}

export const cases: EvalCase[] = [
  // chunking.md
  { question: "What is chunking and why does overlap between chunks matter?", expectSource: "chunking.md" },
  { question: "Why split a document into pieces instead of embedding it whole?", expectSource: "chunking.md" },
  // embeddings.md
  { question: "How does cosine similarity rank chunks during retrieval?", expectSource: "embeddings.md" },
  { question: "What does an embedding represent about a piece of text?", expectSource: "embeddings.md" },
  // grounding.md
  { question: "What does the grounding gate do and why does it matter?", expectSource: "grounding.md" },
  { question: "When should the system refuse to answer a question?", expectSource: "grounding.md" },
  // retrieval.md
  { question: "What is reranking and how does it improve retrieval?", expectSource: "retrieval.md" },
  { question: "Why retrieve a wide candidate set before narrowing to the top-k?", expectSource: "retrieval.md" },
  // faithfulness.md
  { question: "What does the faithfulness check verify after an answer is generated?", expectSource: "faithfulness.md" },
  { question: "What kind of hallucination does the faithfulness check catch?", expectSource: "faithfulness.md" },
  // evaluation.md
  { question: "What does the evaluation harness measure?", expectSource: "evaluation.md" },
  { question: "Why does measuring refusal discipline matter as much as accuracy?", expectSource: "evaluation.md" },

  // Clearly out of corpus: general knowledge the documents never touch.
  { question: "What is the capital of France?", expectSource: null },
  { question: "Who won the 2018 FIFA World Cup?", expectSource: null },

  // Adversarial near-misses: they borrow the corpus's vocabulary but ask about
  // things it does not cover. Surface similarity should not be enough to answer.
  { question: "What is the exact dollar pricing of the OpenAI embeddings API?", expectSource: null, adversarial: true },
  { question: "What learning rate should I use to train my own embedding model?", expectSource: null, adversarial: true },
  { question: "Which vector database is fastest at billion-scale search?", expectSource: null, adversarial: true },
  { question: "How do I deploy this retrieval system on Kubernetes?", expectSource: null, adversarial: true },
];
