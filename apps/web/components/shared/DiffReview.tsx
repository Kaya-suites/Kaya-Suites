"use client";

import { useState } from "react";
import { wordDiff } from "@/lib/diff";
import type { ProposedEdit } from "@/types/chat";

type Props = {
  edit: ProposedEdit;
  editedText: string;
  onTextChange: (editId: string, text: string) => void;
  onApprove: (editId: string, finalText: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

export function DiffReview({ edit, editedText, onTextChange, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (edit.status === "approved") {
    return (
      <div
        className="mt-3 border-2 border-[var(--color-success)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-success)] flex items-center gap-2 font-mono"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "3px 3px 0px var(--color-success)" }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        EDIT APPROVED AND COMMITTED.
      </div>
    );
  }

  if (edit.status === "rejected") {
    return (
      <div
        className="mt-3 border-2 border-black bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-muted)] line-through font-mono"
        style={{ borderRadius: "var(--border-radius)" }}
      >
        EDIT REJECTED.
      </div>
    );
  }

  const diff = wordDiff(edit.original, editedText);

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(edit.id, editedText);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="mt-3 border-2 border-black bg-[var(--color-surface)] overflow-hidden"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="px-4 py-2.5 border-b-2 border-black bg-[var(--color-muted-bg)] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--color-accent)] shrink-0">
          <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-bold text-black uppercase tracking-wider font-mono">Proposed Edit</span>
      </div>

      <div className="px-4 py-3 font-mono text-sm leading-relaxed border-b-2 border-black">
        <div className="mb-1.5 text-xs text-[var(--color-muted)] uppercase tracking-wider font-bold">Changes</div>
        <p className="whitespace-pre-wrap">
          {diff.map((op, i) => {
            if (op.type === "equal") return <span key={i}>{op.text}</span>;
            if (op.type === "delete") {
              return (
                <span key={i} className="bg-[#FFD6CC] text-[var(--color-danger)] line-through px-0.5 border border-[var(--color-danger)]">
                  {op.text}
                </span>
              );
            }
            return (
              <span key={i} className="bg-[#C8F0D8] text-[var(--color-success)] px-0.5 border border-[var(--color-success)]">
                {op.text}
              </span>
            );
          })}
        </p>
      </div>

      <div className="px-4 py-3 border-b-2 border-black">
        <div className="mb-1.5 text-xs text-[var(--color-muted)] uppercase tracking-wider font-bold font-mono">Edit before approving</div>
        <textarea
          value={editedText}
          onChange={(e) => onTextChange(edit.id, e.target.value)}
          rows={3}
          className="w-full text-sm font-mono border-2 border-black px-3 py-2 focus:outline-none focus:border-[var(--color-accent)] resize-y bg-white text-black leading-relaxed"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
        />
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-background)]">
        <button
          onClick={() => onReject(edit.id)}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black text-black hover:bg-[var(--color-muted-bg)] transition-all font-mono"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={loading}
          className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-[var(--color-accent)] text-white disabled:opacity-60 transition-all font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          {loading ? "Approving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
