"use client";

import { useState } from "react";
import type { ProposedDelete } from "@/types/chat";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  deletion: ProposedDelete;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

const statusBase =
  "mt-3 px-4 py-3 rounded-[var(--radius-md)] border text-[var(--font-size-sm)] flex items-center gap-2";

export function DeleteReview({ deletion, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (deletion.status === "approved") {
    return (
      <div
        className={`${statusBase} border-[var(--color-danger)] bg-[var(--color-bg-subtle)] text-[var(--color-danger)]`}
        role="status"
      >
        <Check size={14} strokeWidth={1.8} className="shrink-0" />
        Document deleted.
      </div>
    );
  }

  if (deletion.status === "rejected") {
    return (
      <div
        className={`${statusBase} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)] line-through`}
        role="status"
      >
        Deletion rejected.
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
    <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden border-l-[3px] border-l-[var(--color-danger)]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center gap-2">
        <Trash2 size={14} strokeWidth={1.6} className="text-[var(--color-danger)] shrink-0" />
        <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)]">
          Proposed deletion
        </span>
      </header>

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-[var(--font-size-sm)] text-[var(--color-text)] leading-relaxed">
          Delete <span className="font-semibold">{deletion.docTitle}</span>? This
          action cannot be undone.
        </p>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-bg-subtle)]">
        <Button size="sm" variant="ghost" onClick={() => onReject(deletion.id)}>
          Reject
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={handleApprove}
          disabled={loading}
        >
          {loading ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}
