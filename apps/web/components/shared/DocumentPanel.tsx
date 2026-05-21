"use client";

import { useEffect, useRef, useState } from "react";
import type { KayaDocument } from "@/types/chat";
import { MarkdownContent } from "./markdown/MarkdownContent";

type Props = {
  docId: string | null;
  scrollToParagraphId?: string | null;
  refreshKey?: number;
  onClose: () => void;
};

export function DocumentPanel({ docId, scrollToParagraphId, refreshKey, onClose }: Props) {
  const [doc, setDoc] = useState<KayaDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!docId) { setDoc(null); return; }
    setLoading(true);
    fetch(`/api/documents/${docId}`)
      .then((r) => r.json())
      .then((data: KayaDocument) => setDoc(data))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [docId, refreshKey]);

  useEffect(() => {
    if (!scrollToParagraphId || !contentRef.current) return;
    const match = scrollToParagraphId.match(/^p-(\d+)$/);
    if (!match) return;
    const idx = parseInt(match[1], 10) - 1;
    const paragraphs = contentRef.current.querySelectorAll("p, h2, h3");
    const target = paragraphs[idx] as HTMLElement | undefined;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("outline", "outline-2", "outline-[var(--color-accent)]", "outline-offset-2");
      setTimeout(() => target.classList.remove("outline", "outline-2", "outline-[var(--color-accent)]", "outline-offset-2"), 2000);
    }
  }, [scrollToParagraphId, doc]);

  async function handleExport() {
    if (!docId || !doc) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/documents/${docId}/export`);
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setDownloading(false);
    }
  }

  if (!docId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-muted)] gap-3 p-8 font-mono">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="opacity-40">
          <rect x="8" y="5" width="24" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 14h12M14 19h12M14 24h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-xs text-center leading-relaxed uppercase tracking-wider font-bold">
          Documents appear here when the agent cites one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-5 py-3 border-b-2 border-black bg-[var(--color-background)] shrink-0">
        <h2 className="text-xs font-bold text-black truncate pr-4 uppercase tracking-wider font-mono">
          {loading ? "Loading…" : (doc?.title ?? "Document")}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {doc && (
            <button
              onClick={handleExport}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black text-black hover:bg-[var(--color-muted-bg)] transition-all disabled:opacity-50 font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v9M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {downloading ? "Exporting…" : "Export PDF"}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 border-2 border-black text-black hover:bg-[var(--color-muted-bg)] transition-all"
            style={{ borderRadius: "var(--border-radius)" }}
            title="Close document"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {doc?.tags && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pt-3 pb-0 shrink-0 bg-[var(--color-surface)]">
          {doc.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 border-2 border-black text-black text-xs font-bold uppercase font-mono"
              style={{ borderRadius: "var(--border-radius)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div ref={contentRef} className="flex-1 overflow-y-auto px-8 py-6 min-h-0 bg-[var(--color-surface)]">
        {loading && (
          <div className="flex items-center gap-2 text-[var(--color-muted)] text-sm font-mono">
            <div className="w-4 h-4 border-2 border-black border-t-[var(--color-accent)] rounded-full animate-spin" />
            Loading document…
          </div>
        )}
        {!loading && doc && (
          <div className="prose max-w-none">
            <MarkdownContent markdown={doc.body} />
          </div>
        )}
      </div>
    </div>
  );
}
