"use client";

import { useState } from "react";
import type { ProposedFolderCreate } from "@/types/chat";

type Props = {
  proposal: ProposedFolderCreate;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string) => void;
};

export function FolderCreateReview({ proposal, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (proposal.status === "approved") {
    return (
      <div
        className="mt-3 border-2 border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent)] flex items-center gap-2 font-mono"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "3px 3px 0px var(--color-accent)" }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        FOLDER &ldquo;{proposal.name}&rdquo; CREATED.
      </div>
    );
  }

  if (proposal.status === "rejected") {
    return (
      <div
        className="mt-3 border-2 border-black bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-muted)] line-through font-mono"
        style={{ borderRadius: "var(--border-radius)" }}
      >
        FOLDER CREATION REJECTED.
      </div>
    );
  }

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(proposal.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="mt-3 border-2 border-black bg-[var(--color-surface)] overflow-hidden"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)", borderLeftColor: "var(--color-accent)", borderLeftWidth: "4px" }}
    >
      <div className="px-4 py-2.5 border-b-2 border-black bg-[var(--color-muted-bg)] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)] shrink-0">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        <span className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider font-mono">Proposed Folder</span>
      </div>

      <div className="px-4 py-3 border-b-2 border-black">
        <p className="text-sm font-mono text-black">
          Create folder{" "}
          <span className="font-bold">&ldquo;{proposal.name}&rdquo;</span>
          {proposal.parentId ? " inside the selected folder" : " at the root level"}.
        </p>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-background)]">
        <button
          onClick={() => onReject(proposal.id)}
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
          {loading ? "Creating…" : "Create folder"}
        </button>
      </div>
    </div>
  );
}
