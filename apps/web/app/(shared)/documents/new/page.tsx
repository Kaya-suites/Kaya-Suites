"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, Tag } from "lucide-react";

const KayaMarkdownEditor = dynamic(
  () => import("@kaya/markdown-editor").then((m) => m.KayaMarkdownEditor),
  { ssr: false },
);

export default function NewDocumentPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: body.trim(), tags }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const created = await res.json() as { id: string };
      router.push(`/documents/${created.id}`);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b-2 border-black bg-[var(--color-background)] shrink-0">
        <Link
          href="/documents"
          className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--color-muted)] hover:text-black transition-colors font-mono border-2 border-transparent hover:border-black px-2 py-1"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          <ChevronLeft size={14} />
          Docs
        </Link>

        <div className="flex-1 min-w-0">
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            placeholder="UNTITLED"
            className="w-full text-sm font-bold text-black bg-transparent border-none outline-none placeholder-[var(--color-muted)] font-mono uppercase tracking-wide"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {error && (
            <span className="text-xs text-[var(--color-danger)] font-mono font-bold uppercase">{error}</span>
          )}
          <button
            onClick={handleCreate}
            disabled={submitting || !title.trim()}
            className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-2 px-6 py-2 border-b-2 border-black bg-[var(--color-background)] shrink-0">
        <Tag size={12} className="text-[var(--color-muted)] shrink-0" />
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Add tags, comma-separated…"
          className="flex-1 text-xs text-[var(--color-muted)] bg-transparent border-none outline-none placeholder-[var(--color-muted)] font-mono"
        />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <KayaMarkdownEditor markdown={body} onChange={setBody} />
      </div>
    </div>
  );
}
