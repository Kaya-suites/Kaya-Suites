"use client";

import { useState } from "react";
import type { ProposedFolderCreate } from "@/types/chat";
import { Check, FolderPlus } from "lucide-react";

type Props = {
  proposal: ProposedFolderCreate;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

export function FolderCreateReview({ proposal, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (proposal.status === "approved") {
    return (
      <div
        className="mt-3 border-2 border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent)] flex items-center gap-2 font-mono"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "3px 3px 0px var(--color-accent)" }}
      >
        <Check size={14} strokeWidth={1.8} className="shrink-0" />
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
        <FolderPlus size={14} className="text-[var(--color-accent)] shrink-0" />
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
