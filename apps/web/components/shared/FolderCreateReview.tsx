"use client";

import { useState } from "react";
import type { ProposedFolderCreate } from "@/types/chat";
import { Check, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  proposal: ProposedFolderCreate;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

const statusBase =
  "mt-3 px-4 py-3 rounded-[var(--radius-md)] border text-[var(--font-size-sm)] flex items-center gap-2";

export function FolderCreateReview({ proposal, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (proposal.status === "approved") {
    return (
      <div
        className={`${statusBase} border-[var(--color-success)] bg-[var(--color-bg-subtle)] text-[var(--color-success)]`}
        role="status"
      >
        <Check size={14} strokeWidth={1.8} className="shrink-0" />
        Folder “{proposal.name}” created.
      </div>
    );
  }

  if (proposal.status === "rejected") {
    return (
      <div
        className={`${statusBase} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)] line-through`}
        role="status"
      >
        Folder creation rejected.
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
    <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden border-l-[3px] border-l-[var(--color-text)]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center gap-2">
        <FolderPlus size={14} className="text-[var(--color-text-muted)] shrink-0" />
        <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)]">
          Proposed folder
        </span>
      </header>

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-[var(--font-size-sm)] text-[var(--color-text)] leading-relaxed">
          Create folder{" "}
          <span className="font-semibold">“{proposal.name}”</span>
          {proposal.parentId
            ? " inside the selected folder."
            : " at the root level."}
        </p>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-bg-subtle)]">
        <Button size="sm" variant="ghost" onClick={() => onReject(proposal.id)}>
          Reject
        </Button>
        <Button size="sm" onClick={handleApprove} disabled={loading}>
          {loading ? "Creating…" : "Create folder"}
        </Button>
      </div>
    </div>
  );
}
