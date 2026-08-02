"use client";

// Bring-your-own-document panel. A visitor can upload a .pdf/.txt/.md or paste
// text; it becomes the active corpus for their session, and every answer still
// runs through the same grounding and faithfulness gates. The point to notice:
// ask something the uploaded document does not cover and it still refuses.

import { useEffect, useRef, useState } from "react";
import {
  Database,
  Upload,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface CorpusState {
  type: "default" | "upload";
  sources: string[];
}

export function CorpusPanel({
  corpus,
  onCorpusChange,
  busy,
}: {
  corpus: CorpusState;
  onCorpusChange: (next: CorpusState) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // On mount, reflect any corpus already uploaded in this session.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ingest")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.active && Array.isArray(d.sources) && d.sources.length) {
          onCorpusChange({ type: "upload", sources: d.sources });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (working) return;
    setError("");
    setNote("");
    const form = new FormData();
    if (file) form.set("file", file);
    else if (text.trim()) form.set("text", text);
    else {
      setError("Choose a file or paste some text first.");
      return;
    }
    setWorking(true);
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      onCorpusChange({ type: "upload", sources: data.sources ?? [data.source] });
      setNote(
        data.truncated
          ? `Indexed ${data.chunks} chunks (document was long, so it was truncated).`
          : `Indexed ${data.chunks} chunks. Ask away, including something it does not cover.`,
      );
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
    } catch {
      setError("Network error, please try again.");
    } finally {
      setWorking(false);
    }
  }

  async function reset() {
    if (working) return;
    setWorking(true);
    setError("");
    setNote("");
    try {
      await fetch("/api/ingest", { method: "DELETE" });
      onCorpusChange({ type: "default", sources: [] });
      setOpen(false);
    } catch {
      setError("Could not reset.");
    } finally {
      setWorking(false);
    }
  }

  const usingUpload = corpus.type === "upload";
  const docTabActive = open || usingUpload;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Database className="size-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-xs text-muted-foreground">Answering from</div>
            <div className="truncate text-sm font-medium">
              {usingUpload ? corpus.sources.join(", ") : "Built-in corpus (RAG concepts)"}
            </div>
          </div>
        </div>

        <div className="inline-flex shrink-0 rounded-lg bg-muted p-[3px]">
          <button
            type="button"
            disabled={busy || working}
            onClick={() => (usingUpload ? void reset() : setOpen(false))}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              !docTabActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Built-in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(true)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              docTabActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Your document
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-sm text-muted-foreground">
            Upload a PDF, TXT, or MD file, or paste text. It stays private to your session and
            clears after a day. Then try a question it covers, and one it does not, and watch it
            refuse.
          </p>
          <Input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="cursor-pointer"
          />
          <div className="text-center text-xs text-muted-foreground">or paste text</div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text to answer from…"
            rows={4}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={working}>
              {working ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Indexing…
                </>
              ) : (
                <>
                  <Upload className="size-4" /> Index this document
                </>
              )}
            </Button>
            {usingUpload && (
              <Button variant="ghost" onClick={reset} disabled={working}>
                <RotateCcw className="size-4" /> Reset to built-in
              </Button>
            )}
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-rose-400">
              <AlertCircle className="size-4" /> {error}
            </p>
          )}
        </div>
      )}

      {note && !open && (
        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="size-4" /> {note}
        </div>
      )}
    </Card>
  );
}
