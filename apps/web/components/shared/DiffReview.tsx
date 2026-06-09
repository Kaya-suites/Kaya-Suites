"use client";

import { useState } from "react";
import { wordDiff } from "@/lib/diff";
import type { ProposedEdit } from "@/types/chat";
import { Check, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  edit: ProposedEdit;
  editedText: string;
  onTextChange: (editId: string, text: string) => void;
  onApprove: (editId: string, finalText: string) => Promise<void>;
  onReject: (editId: string) => Promise<void>;
};

const statusBase =
  "mt-3 px-4 py-3 rounded-[var(--radius-md)] border text-[var(--font-size-sm)] flex items-center gap-2";

export function DiffReview({ edit, editedText, onTextChange, onApprove, onReject }: Props) {
  const [loading, setLoading] = useState(false);

  if (edit.status === "approved") {
    return (
      <div
        className={`${statusBase} border-[var(--color-success)] bg-[var(--color-bg-subtle)] text-[var(--color-success)]`}
        role="status"
      >
        <Check size={14} strokeWidth={1.8} className="shrink-0" />
        Edit approved and committed.
      </div>
    );
  }

  if (edit.status === "rejected") {
    return (
      <div
        className={`${statusBase} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)] line-through`}
        role="status"
      >
        Edit rejected.
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
    <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <header className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center gap-2">
        <FileEdit size={14} strokeWidth={1.6} className="text-[var(--color-text-muted)] shrink-0" />
        <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)]">
          Proposed edit
        </span>
      </header>

      <div className="px-4 py-3 text-[var(--font-size-sm)] leading-relaxed border-b border-[var(--color-border)]">
        <div className="mb-1.5 text-[var(--font-size-xs)] text-[var(--color-text-subtle)] tracking-wide">
          Changes
        </div>
        <p className="whitespace-pre-wrap">
          {diff.map((op, i) => {
            if (op.type === "equal") return <span key={i}>{op.text}</span>;
            if (op.type === "delete") {
              return (
                <span
                  key={i}
                  className="bg-[var(--color-bg-subtle)] text-[var(--color-danger)] line-through px-0.5 rounded-[var(--radius-sm)]"
                >
                  {op.text}
                </span>
              );
            }
            return (
              <span
                key={i}
                className="bg-[var(--color-bg-subtle)] text-[var(--color-success)] px-0.5 rounded-[var(--radius-sm)]"
              >
                {op.text}
              </span>
            );
          })}
        </p>
      </div>

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="mb-1.5 text-[var(--font-size-xs)] text-[var(--color-text-subtle)] tracking-wide">
          Edit before approving
        </div>
        <textarea
          value={editedText}
          onChange={(e) => onTextChange(edit.id, e.target.value)}
          rows={3}
          className="w-full text-[var(--font-size-sm)] px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text)] leading-relaxed resize-y focus:outline-none focus:border-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        />
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2 justify-end bg-[var(--color-bg-subtle)]">
        <Button size="sm" variant="ghost" onClick={() => onReject(edit.id)}>
          Reject
        </Button>
        <Button size="sm" onClick={handleApprove} disabled={loading}>
          {loading ? "Approving…" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
