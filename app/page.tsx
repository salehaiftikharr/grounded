"use client";

import { useState } from "react";

interface Hit {
  source: string;
  score: number;
  snippet: string;
}

interface AskResult {
  grounded: boolean;
  topScore: number;
  answer: string;
  citations: { source: string; score: number }[];
  retrieval: Hit[];
}

const EXAMPLES = [
  "What does the grounding gate do?",
  "Why does chunk overlap matter?",
  "How does reranking improve retrieval?",
  "What is the capital of France?",
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");

  async function ask(q: string) {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setResult(data as AskResult);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <h1 className="brand">Grounded</h1>
      <p className="tagline">
        Ask a question. It answers from the corpus with citations — or tells you it does not know.
      </p>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="chip"
            onClick={() => {
              setQuestion(ex);
              void ask(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about chunking, embeddings, retrieval, grounding…"
          maxLength={500}
        />
        <button type="submit" disabled={loading || !question.trim()}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error && <p className="error">⚠ {error}</p>}

      {result && (
        <section className="result">
          <span className={`badge ${result.grounded ? "good" : "warn"}`}>
            {result.grounded
              ? `✓ Grounded · top match ${result.topScore.toFixed(2)}`
              : "⊘ Not grounded · refused to answer"}
          </span>

          <div className="answer">{result.answer}</div>

          {result.grounded && result.citations.length > 0 && (
            <p className="citations">
              <b>Sources:</b> {result.citations.map((c) => c.source).join(", ")}
            </p>
          )}

          <div className="section-label">
            Retrieved context {result.grounded ? "(used to answer)" : "(too weak — gate refused)"}
          </div>
          {result.retrieval.map((h, i) => (
            <div className="hit" key={i}>
              <div className="hit-head">
                <span className="hit-source">
                  [{i + 1}] {h.source}
                </span>
                <span className="hit-score">similarity {h.score.toFixed(3)}</span>
              </div>
              <div className="bar">
                <span style={{ width: `${Math.max(0, Math.min(100, h.score * 100))}%` }} />
              </div>
              <div className="hit-snippet">{h.snippet}…</div>
            </div>
          ))}
        </section>
      )}

      <p className="foot">
        Grounded retrieves locally and only calls the model to answer; the grounding gate refuses
        when retrieval is too weak.{" "}
        <a href="https://github.com/salehaiftikharr/grounded" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </main>
  );
}
