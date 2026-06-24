"use client";

import { useState } from "react";

interface Hit {
  source: string;
  score: number;
  snippet: string;
}

interface ClaimCheck {
  claim: string;
  supported: boolean;
  evidence: string;
}

interface Faithfulness {
  verdict: "supported" | "partial" | "unsupported" | "skipped";
  score: number;
  claims: ClaimCheck[];
  unsupported: string[];
}

interface Timings {
  retrieveMs: number;
  generateMs: number;
  verifyMs: number;
  totalMs: number;
}

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface AskResult {
  grounded: boolean;
  topScore: number;
  answer: string;
  citations: { source: string; score: number }[];
  retrieval: Hit[];
  faithfulness: Faithfulness | null;
  timings: Timings;
  usage: TokenUsage;
}

const EXAMPLES = [
  "What does the grounding gate do?",
  "How does the faithfulness check catch hallucinations?",
  "Why does chunk overlap matter?",
  "What is the capital of France?",
];

const FAITH_LABEL: Record<Faithfulness["verdict"], { cls: string; text: (f: Faithfulness) => string }> = {
  supported: { cls: "good", text: (f) => `✓ Answer verified · all ${f.claims.length} claims supported by sources` },
  partial: { cls: "warn", text: (f) => `⚠ ${f.unsupported.length} of ${f.claims.length} claims not supported by sources` },
  unsupported: { cls: "bad", text: () => "⊘ Answer not supported by the retrieved sources" },
  skipped: { cls: "warn", text: () => "Faithfulness check skipped" },
};

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

  const faith = result?.faithfulness;
  const faithMeta = faith && faith.verdict !== "skipped" ? FAITH_LABEL[faith.verdict] : null;

  return (
    <main className="wrap">
      <h1 className="brand">Grounded</h1>
      <p className="tagline">
        Ask a question. It answers from the corpus with citations, verifies every claim against the
        sources, and tells you when it does not know.
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
          <div className="badges">
            <span className={`badge ${result.grounded ? "good" : "warn"}`}>
              {result.grounded
                ? `✓ Grounded · top match ${result.topScore.toFixed(2)}`
                : "⊘ Not grounded · refused to answer"}
            </span>
            {faithMeta && <span className={`badge ${faithMeta.cls}`}>{faithMeta.text(faith!)}</span>}
          </div>

          <div className="answer">{result.answer}</div>

          {result.grounded && result.citations.length > 0 && (
            <p className="citations">
              <b>Sources:</b> {result.citations.map((c) => c.source).join(", ")}
            </p>
          )}

          {faith && faith.claims.length > 0 && (
            <>
              <div className="section-label">Claim check (answer verified against sources)</div>
              {faith.claims.map((c, i) => (
                <div className={`claim ${c.supported ? "ok" : "bad"}`} key={i}>
                  <div className="claim-head">
                    <span className="claim-mark">{c.supported ? "✓" : "✗"}</span>
                    <span className="claim-text">{c.claim}</span>
                  </div>
                  {c.evidence && <div className="claim-evidence">“{c.evidence}”</div>}
                </div>
              ))}
            </>
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

          <div className="trace">
            <span>retrieve {result.timings.retrieveMs}ms</span>
            <span>generate {result.timings.generateMs}ms</span>
            <span>verify {result.timings.verifyMs}ms</span>
            <span>{result.usage.total} tokens</span>
          </div>
        </section>
      )}

      <p className="foot">
        Grounded guards both ends: it refuses when retrieval is too weak, and verifies every claim in
        the answer against the sources before trusting it.{" "}
        <a href="https://github.com/salehaiftikharr/grounded" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </main>
  );
}
