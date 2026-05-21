"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentList } from "@/components/shared/DocumentList";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/documents")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DocumentSummary[]) => setDocuments(data))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showForm) titleRef.current?.focus();
  }, [showForm]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const created = await res.json() as DocumentSummary;
      setDocuments((prev) => [created, ...prev]);
      setTitle("");
      setContent("");
      setShowForm(false);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full text-sm border-2 border-black px-3 py-2 focus:outline-none focus:border-[var(--color-accent)] bg-white text-black font-mono placeholder:text-[var(--color-muted)]";

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--color-background)" }}>
      <div className="border-b-2 border-black bg-[var(--color-background)]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xs font-bold text-black uppercase tracking-wider font-mono">Documents</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-muted)] font-mono">
              {!loading && `${documents.length} doc${documents.length !== 1 ? "s" : ""}`}
            </span>
            <button
              onClick={() => { setShowForm((v) => !v); setError(null); }}
              className="text-xs px-3 py-1.5 border-2 border-black font-bold uppercase tracking-wider font-mono transition-all hover:bg-[var(--color-muted-bg)]"
              style={{ borderRadius: "var(--border-radius)", background: showForm ? "var(--color-muted-bg)" : "var(--color-surface)", boxShadow: "var(--shadow-button)" }}
            >
              {showForm ? "Cancel" : "Import"}
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="max-w-3xl mx-auto mt-4 px-4">
          <form
            onSubmit={handleSubmit}
            className="bg-[var(--color-surface)] border-2 border-black p-5 space-y-3"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <input
              ref={titleRef}
              type="text"
              placeholder="Document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              required
            />
            <textarea
              placeholder="Paste Markdown content here…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className={`${inputClass} resize-y`}
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              required
            />
            {error && <p className="text-xs text-[var(--color-danger)] font-mono font-bold">{error}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !content.trim()}
                className="text-xs px-4 py-2 border-2 border-black bg-[var(--color-accent)] text-white font-bold uppercase tracking-wider font-mono disabled:opacity-50"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
              >
                {submitting ? "Saving…" : "Save document"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div
        className="max-w-3xl mx-auto py-0 bg-[var(--color-surface)] mt-4 mx-4 border-2 border-black"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <DocumentList documents={documents} loading={loading} />
      </div>
    </div>
  );
}
