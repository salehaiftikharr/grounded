"use client";

// Bring-your-own-document panel. A visitor can upload a .pdf/.txt/.md or paste
// text; it becomes the active corpus for their session, and every answer still
// runs through the same grounding and faithfulness gates. The point to notice:
// ask something the uploaded document does not cover and it still refuses.

import { useEffect, useRef, useState } from "react";

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
          : `Indexed ${data.chunks} chunks. Ask away — including something it does not cover.`,
      );
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
    } catch {
      setError("Network error — please try again.");
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
    } catch {
      setError("Could not reset.");
    } finally {
      setWorking(false);
    }
  }

  const usingUpload = corpus.type === "upload";

  return (
    <div className="corpus">
      <div className="corpus-bar">
        <span className={`corpus-tag ${usingUpload ? "upload" : "default"}`}>
          {usingUpload
            ? `Answering from your document: ${corpus.sources.join(", ")}`
            : "Answering from the built-in corpus (RAG concepts)"}
        </span>
        <div className="corpus-actions">
          {usingUpload && (
            <button type="button" className="corpus-link" onClick={reset} disabled={working || busy}>
              Reset to default
            </button>
          )}
          <button
            type="button"
            className="corpus-link"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
          >
            {open ? "Close" : usingUpload ? "Replace document" : "Use your own document"}
          </button>
        </div>
      </div>

      {open && (
        <div className="corpus-form">
          <p className="corpus-hint">
            Upload a PDF, TXT, or MD file, or paste text. It stays private to your session and
            clears after a day. Then try a question it covers, and one it does not, and watch it
            refuse.
          </p>
          <label className="corpus-file">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="corpus-or">or paste text</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text to answer from…"
            rows={4}
          />
          <div className="corpus-submit">
            <button type="button" onClick={submit} disabled={working}>
              {working ? "Indexing…" : "Index this document"}
            </button>
          </div>
          {error && <p className="corpus-error">⚠ {error}</p>}
        </div>
      )}

      {note && !open && <p className="corpus-note">{note}</p>}
    </div>
  );
}
