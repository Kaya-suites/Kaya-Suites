"use client";

import { useState } from "react";
import type { ChatMessageData, CitationRef } from "@/types/chat";
import { DiffReview } from "./DiffReview";
import { DeleteReview } from "./DeleteReview";
import { FolderCreateReview } from "./FolderCreateReview";
import { MarkdownContent } from "@kaya/markdown-editor";
import { Button } from "@/components/ui/button";

type Props = {
  message: ChatMessageData;
  isStreaming?: boolean;
  onCitationClick: (ref: CitationRef) => void;
  onApproveEdit: (editId: string, finalText: string) => Promise<void>;
  onRejectEdit: (editId: string) => Promise<void>;
  onApproveDelete: (editId: string) => Promise<void>;
  onRejectDelete: (editId: string) => Promise<void>;
  onApproveFolderCreate: (editId: string) => Promise<void>;
  onRejectFolderCreate: (editId: string) => Promise<void>;
  onEditTextChange: (editId: string, text: string) => void;
  editTexts: Record<string, string>;
  onApproveAll: (messageId: string) => Promise<void>;
  onRejectAll: (messageId: string) => Promise<void>;
};

function CitationText({
  children,
  citations,
  onCitationClick,
}: {
  children: string;
  citations: CitationRef[];
  onCitationClick: (ref: CitationRef) => void;
}) {
  const parts = children.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const label = parseInt(match[1], 10);
          const ref = citations.find((c) => c.label === label);
          if (ref) {
            return (
              <sup key={i}>
                <button
                  onClick={() => onCitationClick(ref)}
                  className="inline-flex items-center justify-center w-4 h-4 ml-0.5 text-[10px] font-medium leading-none bg-[var(--color-accent)] text-[var(--color-accent-fg)] rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                  title={`Open: ${ref.title}`}
                >
                  {label}
                </button>
              </sup>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function ChatMessage({
  message,
  isStreaming,
  onCitationClick,
  onApproveEdit,
  onRejectEdit,
  onApproveDelete,
  onRejectDelete,
  onApproveFolderCreate,
  onRejectFolderCreate,
  onEditTextChange,
  editTexts,
  onApproveAll,
  onRejectAll,
}: Props) {
  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%] bg-[var(--color-accent)] text-[var(--color-accent-fg)] px-4 py-2.5 text-[var(--font-size-base)] leading-relaxed rounded-[var(--radius-lg)]">
          {message.content}
        </div>
      </div>
    );
  }

  const pendingEdits = message.proposedEdits?.filter((e) => e.status === "pending") ?? [];
  const pendingDeletes = message.proposedDeletes?.filter((d) => d.status === "pending") ?? [];
  const pendingFolderCreates = message.proposedFolderCreates?.filter((f) => f.status === "pending") ?? [];
  const pendingCount = pendingEdits.length + pendingDeletes.length + pendingFolderCreates.length;

  async function handleApproveAll() {
    setApproveAllLoading(true);
    try {
      await onApproveAll(message.id);
    } finally {
      setApproveAllLoading(false);
    }
  }

  async function handleRejectAll() {
    setApproveAllLoading(true);
    try {
      await onRejectAll(message.id);
    } finally {
      setApproveAllLoading(false);
    }
  }

  return (
    <div className="flex mb-6 gap-3">
      <div className="shrink-0 w-7 h-7 mt-0.5 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] text-[var(--color-text)] text-[var(--font-size-xs)] font-semibold">
        K
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[var(--font-size-base)] text-[var(--color-text)] leading-relaxed [&>*:last-child]:mb-0">
          {message.content ? (
            <MarkdownContent
              markdown={message.content}
              isStreaming={isStreaming}
              decorateText={(text) => (
                <CitationText citations={message.citations} onCitationClick={onCitationClick}>
                  {text}
                </CitationText>
              )}
            />
          ) : null}

          {isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-1 bg-[var(--color-text)] animate-pulse align-text-bottom" />
          )}
        </div>

        {message.proposedEdits?.map((edit) => (
          <DiffReview
            key={edit.id}
            edit={edit}
            editedText={editTexts[edit.id] ?? edit.proposed}
            onTextChange={onEditTextChange}
            onApprove={onApproveEdit}
            onReject={onRejectEdit}
          />
        ))}

        {message.proposedDeletes?.map((deletion) => (
          <DeleteReview
            key={deletion.id}
            deletion={deletion}
            onApprove={onApproveDelete}
            onReject={onRejectDelete}
          />
        ))}

        {message.proposedFolderCreates?.map((proposal) => (
          <FolderCreateReview
            key={proposal.id}
            proposal={proposal}
            onApprove={onApproveFolderCreate}
            onReject={onRejectFolderCreate}
          />
        ))}

        {pendingCount >= 2 && (
          <div className="mt-3 flex items-center gap-2 justify-end border-t border-[var(--color-border)] pt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRejectAll}
              disabled={approveAllLoading}
            >
              Reject all
            </Button>
            <Button
              size="sm"
              onClick={handleApproveAll}
              disabled={approveAllLoading}
            >
              {approveAllLoading ? "Approving…" : `Approve all (${pendingCount})`}
            </Button>
          </div>
        )}

        {message.citations.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Array.from(
              message.citations.reduce((map, c) => {
                if (!map.has(c.docId)) map.set(c.docId, { first: c, labels: [] });
                map.get(c.docId)!.labels.push(c.label);
                return map;
              }, new Map<string, { first: CitationRef; labels: number[] }>()),
            ).map(([docId, { first, labels }]) => (
              <button
                key={docId}
                onClick={() => onCitationClick(first)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--font-size-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <span className="inline-flex items-center gap-0.5">
                  {labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[9px] font-medium text-[var(--color-accent-fg)]"
                    >
                      {label}
                    </span>
                  ))}
                </span>
                {first.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
