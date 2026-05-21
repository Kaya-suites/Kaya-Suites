"use client";

import Link from "next/link";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
};

type Props = {
  documents: DocumentSummary[];
  loading: boolean;
};

export function DocumentList({ documents, loading }: Props) {
  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ borderRadius: "var(--border-radius)" }} />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--color-muted)] text-sm gap-3 font-mono">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p className="uppercase tracking-wider text-xs font-bold">No documents yet. Ask Kaya to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y-2 divide-black">
      {documents.map((doc) => (
        <Link
          key={doc.id}
          href={`/documents/${doc.id}`}
          className="flex items-start gap-4 px-6 py-4 hover:bg-[var(--color-muted-bg)] transition-colors group"
        >
          <div className="shrink-0 mt-0.5 text-[var(--color-muted)] group-hover:text-[var(--color-accent)] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-black group-hover:text-[var(--color-accent)] truncate transition-colors font-mono">
              {doc.title}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {doc.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 border-2 border-black text-black text-xs font-bold uppercase font-mono"
                  style={{ borderRadius: "var(--border-radius)" }}
                >
                  {tag}
                </span>
              ))}
              {doc.lastReviewed && (
                <span className="text-xs text-[var(--color-muted)] font-mono">
                  Reviewed {doc.lastReviewed}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-[var(--color-muted)] group-hover:text-black mt-0.5 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      ))}
    </div>
  );
}
