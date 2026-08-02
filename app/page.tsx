"use client";

import { useState } from "react";
import {
  ShieldCheck,
  BadgeCheck,
  Ban,
  Check,
  X,
  Search,
  Sparkles,
  Loader2,
  ChevronDown,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { MicButton, SpeakAnswer } from "./components/VoiceControls";
import { CorpusPanel, type CorpusState } from "./components/CorpusPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Hit {
  source: string;
  score: number;
  snippet: string;
}

interface ClaimCheck {
  claim: string;
  supported: boolean;
  evidence: string;
  evidenceLocated: boolean;
  sourceIndex: number | null;
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

// Semantic trust colors, kept distinct from the indigo brand: emerald = verified,
// amber = held back, rose = unsupported.
const OK = "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
const WARN = "border-amber-500/25 bg-amber-500/10 text-amber-300";
const BAD = "border-rose-500/25 bg-rose-500/10 text-rose-300";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [corpus, setCorpus] = useState<CorpusState>({ type: "default", sources: [] });

  async function ask(q: string) {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setShowDetails(false);
    setActiveCite(null);
    setActiveEvidence(null);
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
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Click a citation or a claim -> reveal details, highlight the matching chunk,
  // optionally highlight the exact supporting sentence, and scroll it into view.
  function focus(n: number | null, evidence: string | null = null) {
    setShowDetails(true);
    setActiveCite(n);
    setActiveEvidence(evidence);
    if (n != null) {
      requestAnimationFrame(() => {
        document.getElementById(`hit-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  // Wrap the located supporting span in a <mark> so the source sentence stands out.
  function highlightSnippet(text: string, evidence: string | null) {
    if (!evidence) return text;
    const needle = evidence.replace(/\s+/g, " ").trim();
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1 || needle.length < 8) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-primary/25 px-0.5 text-foreground">
          {text.slice(idx, idx + needle.length)}
        </mark>
        {text.slice(idx + needle.length)}
      </>
    );
  }

  // Render the answer with [1], [2]... turned into clickable superscripts.
  function renderAnswer(text: string) {
    return text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const n = Number(m[1]);
      return (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <button
              onClick={() => focus(n)}
              className={cn(
                "mx-0.5 inline-flex h-4 min-w-4 -translate-y-1 cursor-pointer items-center justify-center rounded px-1 align-baseline text-[10px] font-semibold transition-colors",
                activeCite === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/15 text-primary hover:bg-primary/25",
              )}
            >
              {n}
            </button>
          </TooltipTrigger>
          <TooltipContent>Show source [{n}]</TooltipContent>
        </Tooltip>
      );
    });
  }

  const faith = result?.faithfulness;
  const showFaith = !!faith && faith.verdict !== "skipped";
  const faithClass =
    faith?.verdict === "supported" ? OK : faith?.verdict === "partial" ? WARN : BAD;
  const faithText =
    faith?.verdict === "supported"
      ? `Faithful to sources · all ${faith.claims.length} claims supported`
      : faith?.verdict === "partial"
        ? `${faith.unsupported.length} of ${faith.claims.length} claims unsupported`
        : "Answer not supported by the sources";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10 sm:py-14">
      {/* Brand + intro */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-lg shadow-primary/20">
            <ShieldCheck className="size-5" />
          </span>
          <span className="text-2xl font-bold tracking-tight">Grounded</span>
          <Badge
            variant="outline"
            className="ml-0.5 hidden border-primary/25 bg-primary/5 text-primary sm:inline-flex"
          >
            Retrieval Q&amp;A with guardrails
          </Badge>
        </div>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          A question-answering agent that cites its sources, checks every claim, and refuses to
          bluff when it does not know.
        </p>
      </header>

      {/* Corpus source */}
      <CorpusPanel
        corpus={corpus}
        busy={loading}
        onCorpusChange={(next) => {
          setCorpus(next);
          setResult(null);
          setError("");
        }}
      />

      {/* Ask */}
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <Search className="ml-1.5 size-4 shrink-0 text-muted-foreground" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about chunking, embeddings, retrieval, grounding…"
              maxLength={500}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <MicButton
              onQuestion={(q) => {
                setQuestion(q);
                void ask(q);
              }}
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !question.trim()}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Thinking
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Ask
                </>
              )}
            </Button>
          </div>
        </form>

        {corpus.type === "default" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
              Try one
            </span>
            {EXAMPLES.map((ex) => (
              <Button
                key={ex}
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                className="rounded-full font-normal text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setQuestion(ex);
                  void ask(ex);
                }}
              >
                {ex}
              </Button>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            <AlertCircle className="size-4 shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Retrieving, generating, and
              verifying every claim…
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && !loading && (
        <Card className="animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={result.grounded ? OK : WARN}>
                {result.grounded ? (
                  <>
                    <ShieldCheck className="size-3" /> Grounded · top match{" "}
                    {result.topScore.toFixed(2)}
                  </>
                ) : (
                  <>
                    <Ban className="size-3" /> Not grounded · refused to answer
                  </>
                )}
              </Badge>
              {showFaith && (
                <Badge variant="outline" className={faithClass}>
                  {faith!.verdict === "supported" ? (
                    <BadgeCheck className="size-3" />
                  ) : (
                    <AlertCircle className="size-3" />
                  )}
                  {faithText}
                </Badge>
              )}
              <div className="ml-auto">
                <SpeakAnswer text={result.answer} />
              </div>
            </div>

            <div
              className={cn(
                "text-[15px] leading-relaxed",
                !result.grounded && "text-muted-foreground",
              )}
            >
              {renderAnswer(result.answer)}
            </div>

            {result.grounded && result.citations.length > 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Sources:</span>{" "}
                {result.citations.map((c) => c.source).join(", ")}
              </p>
            )}

            <Collapsible open={showDetails || !result.grounded} onOpenChange={setShowDetails}>
              {result.grounded && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    <ChevronDown
                      className={cn("size-4 transition-transform", showDetails && "rotate-180")}
                    />
                    {showDetails ? "Hide the work" : "Show the work: claim check, retrieval, trace"}
                  </Button>
                </CollapsibleTrigger>
              )}

              <CollapsibleContent className="space-y-5 pt-3">
                {faith && faith.claims.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Claim check
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A second model verifies each statement against a real quote in the sources.
                      Click a verified claim to see it.
                    </p>
                    {faith.claims.map((c, i) => {
                      const verified = c.supported && c.evidenceLocated;
                      return (
                        <div
                          key={i}
                          onClick={() => verified && c.sourceIndex && focus(c.sourceIndex, c.evidence)}
                          className={cn(
                            "rounded-lg border p-3",
                            verified
                              ? "border-emerald-500/20 bg-emerald-500/5"
                              : "border-rose-500/20 bg-rose-500/5",
                            verified && "cursor-pointer hover:bg-emerald-500/10",
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {verified ? (
                              <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                            ) : (
                              <X className="mt-0.5 size-4 shrink-0 text-rose-400" />
                            )}
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm">{c.claim}</div>
                              {c.evidence && (
                                <div className="text-xs italic text-muted-foreground">
                                  &ldquo;{c.evidence}&rdquo;
                                </div>
                              )}
                              <div className="text-[11px] text-muted-foreground">
                                {verified
                                  ? `verified in ${c.sourceIndex ? `[${c.sourceIndex}]` : "sources"}`
                                  : c.supported && !c.evidenceLocated
                                    ? "quote not found in the sources"
                                    : "not supported"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Retrieved context{" "}
                    {result.grounded ? "(used to answer)" : "(too weak, so the gate refused)"}
                  </div>
                  {result.retrieval.map((h, i) => (
                    <div
                      key={i}
                      id={`hit-${i + 1}`}
                      className={cn(
                        "scroll-mt-24 rounded-lg border p-3 transition-colors",
                        activeCite === i + 1 ? "border-primary/40 bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">
                          [{i + 1}] {h.source}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          similarity {h.score.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(0, Math.min(100, h.score * 100))}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {highlightSnippet(h.snippet, activeCite === i + 1 ? activeEvidence : null)}…
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-2 py-1">
                    retrieve {result.timings.retrieveMs}ms
                  </span>
                  <span className="rounded bg-muted px-2 py-1">
                    generate {result.timings.generateMs}ms
                  </span>
                  <span className="rounded bg-muted px-2 py-1">
                    verify {result.timings.verifyMs}ms
                  </span>
                  <span className="rounded bg-muted px-2 py-1">{result.usage.total} tokens</span>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      {/* Empty state: explain the two gates instead of a void */}
      {!result && !loading && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="gap-0 py-0">
            <CardContent className="space-y-2 p-4">
              <span className="grid size-8 place-items-center rounded-md bg-emerald-500/10 text-emerald-400">
                <ShieldCheck className="size-4" />
              </span>
              <div className="text-sm font-medium">Grounding gate</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Refuses to answer when retrieval is too weak, instead of guessing. Ask something
                outside the corpus and watch it decline.
              </p>
            </CardContent>
          </Card>
          <Card className="gap-0 py-0">
            <CardContent className="space-y-2 p-4">
              <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                <BadgeCheck className="size-4" />
              </span>
              <div className="text-sm font-medium">Faithfulness check</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                A second model verifies every claim in the answer against a real quote in the
                sources, and flags anything unsupported.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Spacer pushes the footer down so a short page never reads as a void. */}
      <div className="flex-1" />

      <footer className="border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
        Two gates guard every answer: retrieval has to be strong enough to respond, and each claim
        has to trace back to a real quote in the sources.{" "}
        <a
          href="https://github.com/salehaiftikharr/grounded"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Source on GitHub <ExternalLink className="size-3" />
        </a>
      </footer>
    </main>
  );
}
