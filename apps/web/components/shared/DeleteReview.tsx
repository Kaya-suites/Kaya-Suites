"use client";

import { useState } from "react";
import type { ProposedDelete } from "@/types/chat";

type Props = {
  deletion: ProposedDelete;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

export function DeleteReview({ deletion, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (deletion.status === "approved") {
    return (
      <div
        className="mt-3 border-2 border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-danger)] flex items-center gap-2 font-mono"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "3px 3px 0px var(--color-danger)" }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        DOCUMENT DELETED.
      </div>
    );
  }

  if (deletion.status === "rejected") {
    return (
      <div
        className="mt-3 border-2 border-black bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-muted)] line-through font-mono"
        style={{ borderRadius: "var(--border-radius)" }}
      >
        DELETION REJECTED.
      </div>
    );
  }

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(deletion.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="mt-3 border-2 border-black bg-[var(--color-surface)] overflow-hidden"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)", borderLeftColor: "var(--color-danger)", borderLeftWidth: "4px" }}
    >
      <div className="px-4 py-2.5 border-b-2 border-black bg-[#FFD6CC] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--color-danger)] shrink-0">
          <path d="M2 4h12M6 4V2h4v2M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-bold text-[var(--color-danger)] uppercase tracking-wider font-mono">Proposed Deletion</span>
      </div>

      <div className="px-4 py-3 border-b-2 border-black">
        <p className="text-sm font-mono text-black">
          Delete{" "}
          <span className="font-bold">{deletion.docTitle}</span>?{" "}
          This action cannot be undone.
        </p>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-background)]">
        <button
          onClick={() => onReject(deletion.id)}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black text-black hover:bg-[var(--color-muted-bg)] transition-all font-mono"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={loading}
          className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-[var(--color-danger)] text-white disabled:opacity-60 transition-all font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          {loading ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
