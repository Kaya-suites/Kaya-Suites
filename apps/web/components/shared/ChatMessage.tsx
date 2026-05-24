"use client";

import { useState } from "react";
import type { ChatMessageData, CitationRef } from "@/types/chat";
import { DiffReview } from "./DiffReview";
import { DeleteReview } from "./DeleteReview";
import { FolderCreateReview } from "./FolderCreateReview";
import { MarkdownContent } from "./markdown/MarkdownContent";

type Props = {
  message: ChatMessageData;
  isStreaming?: boolean;
  onCitationClick: (ref: CitationRef) => void;
  onApproveEdit: (editId: string, finalText: string) => Promise<void>;
  onRejectEdit: (editId: string) => void;
  onApproveDelete: (editId: string) => Promise<void>;
  onRejectDelete: (editId: string) => void;
  onApproveFolderCreate: (editId: string) => Promise<void>;
  onRejectFolderCreate: (editId: string) => void;
  onEditTextChange: (editId: string, text: string) => void;
  editTexts: Record<string, string>;
  onApproveAll: (messageId: string) => Promise<void>;
  onRejectAll: (messageId: string) => void;
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
                  className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold border-2 border-black bg-[var(--color-accent)] text-white leading-none ml-0.5 cursor-pointer font-mono"
                  style={{ borderRadius: "var(--border-radius)" }}
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
        <div
          className="max-w-[75%] bg-[var(--color-accent)] text-white border-2 border-black px-4 py-2.5 text-sm leading-relaxed font-mono font-bold"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-bubble)" }}
        >
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

  return (
    <div className="flex mb-5 gap-3">
      <div
        className="shrink-0 w-7 h-7 border-2 border-black bg-black flex items-center justify-center text-white text-xs font-bold mt-0.5 font-mono"
        style={{ borderRadius: "var(--border-radius)" }}
      >
        K
      </div>

      <div className="flex-1 min-w-0">
        <div
          className="border-2 border-black bg-[var(--color-surface)] px-4 py-3 font-mono text-sm text-black [&>*:last-child]:mb-0"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-bubble)" }}
        >
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
            <span className="inline-block w-2 h-4 ml-1 bg-[var(--color-accent)] animate-pulse align-text-bottom" />
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
          <div className="mt-3 flex items-center gap-2 justify-end border-t-2 border-black pt-3">
            <button
              onClick={() => onRejectAll(message.id)}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black text-black hover:bg-[var(--color-muted-bg)] transition-all font-mono"
              style={{ borderRadius: "var(--border-radius)" }}
            >
              Reject all
            </button>
            <button
              onClick={handleApproveAll}
              disabled={approveAllLoading}
              className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-[var(--color-accent)] text-white disabled:opacity-60 font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              {approveAllLoading ? "Approving…" : `Approve all (${pendingCount})`}
            </button>
          </div>
        )}

        {message.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from(
              message.citations.reduce((map, c) => {
                if (!map.has(c.docId)) map.set(c.docId, { first: c, labels: [] });
                map.get(c.docId)!.labels.push(c.label);
                return map;
              }, new Map<string, { first: CitationRef; labels: number[] }>())
            ).map(([docId, { first, labels }]) => (
              <button
                key={docId}
                onClick={() => onCitationClick(first)}
                className="inline-flex items-center gap-1.5 px-2 py-1 border-2 border-black bg-[var(--color-surface)] text-xs text-black font-bold uppercase tracking-wide hover:bg-[var(--color-muted-bg)] transition-all font-mono"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                <span className="inline-flex items-center gap-0.5">
                  {labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center justify-center w-3.5 h-3.5 border border-black bg-[var(--color-accent)] text-[9px] font-bold text-white"
                      style={{ borderRadius: "var(--border-radius)" }}
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
