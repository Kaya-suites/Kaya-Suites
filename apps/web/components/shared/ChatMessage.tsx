"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { ChatMessageData, CitationRef } from "@/types/chat";
import { DiffReview } from "./DiffReview";
import { DeleteReview } from "./DeleteReview";

type Props = {
  message: ChatMessageData;
  isStreaming?: boolean;
  onCitationClick: (ref: CitationRef) => void;
  onApproveEdit: (editId: string, finalText: string) => Promise<void>;
  onRejectEdit: (editId: string) => void;
  onApproveDelete: (editId: string) => Promise<void>;
  onRejectDelete: (editId: string) => void;
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
  onEditTextChange,
  editTexts,
  onApproveAll,
  onRejectAll,
}: Props) {
  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const isUser = message.role === "user";

  const components: Components = {
    p({ children }) {
      const text = typeof children === "string" ? children : null;
      if (text) {
        return (
          <p className="mb-3 last:mb-0 font-mono">
            <CitationText citations={message.citations} onCitationClick={onCitationClick}>
              {text}
            </CitationText>
          </p>
        );
      }
      const nodes = Array.isArray(children) ? children : [children];
      return (
        <p className="mb-3 last:mb-0 font-mono">
          {nodes.map((child, i) =>
            typeof child === "string" ? (
              <CitationText key={i} citations={message.citations} onCitationClick={onCitationClick}>
                {child}
              </CitationText>
            ) : (
              child
            ),
          )}
        </p>
      );
    },
    code({ children, className }) {
      const isBlock = className?.startsWith("language-");
      if (isBlock) {
        return (
          <code className="block bg-[var(--color-muted-bg)] border-2 border-black p-3 text-xs font-mono text-black overflow-x-auto whitespace-pre">
            {children}
          </code>
        );
      }
      return (
        <code className="bg-[var(--color-muted-bg)] border border-black px-1 py-0.5 text-xs font-mono text-black">
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <pre className="mb-3 last:mb-0">{children}</pre>;
    },
    ul({ children }) {
      return <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1 font-mono">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1 font-mono">{children}</ol>;
    },
    li({ children }) {
      return <li className="text-black font-mono">{children}</li>;
    },
    strong({ children }) {
      return <strong className="font-bold text-black">{children}</strong>;
    },
    a({ href, children }) {
      return (
        <a href={href} className="text-[var(--color-accent)] underline font-bold hover:opacity-70">
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto mb-3 last:mb-0">
          <table className="text-xs border-collapse w-full border-2 border-black font-mono">{children}</table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="border-2 border-black px-3 py-1.5 bg-[var(--color-muted-bg)] text-left font-bold text-black text-xs uppercase tracking-wide">
          {children}
        </th>
      );
    },
    td({ children }) {
      return <td className="border-2 border-black px-3 py-1.5 text-black font-mono">{children}</td>;
    },
  };

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
  const pendingCount = pendingEdits.length + pendingDeletes.length;

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
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {message.content}
            </ReactMarkdown>
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
            {message.citations.map((c) => (
              <button
                key={c.label}
                onClick={() => onCitationClick(c)}
                className="inline-flex items-center gap-1.5 px-2 py-1 border-2 border-black bg-[var(--color-surface)] text-xs text-black font-bold uppercase tracking-wide hover:bg-[var(--color-muted-bg)] transition-all font-mono"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                <span
                  className="inline-flex items-center justify-center w-3.5 h-3.5 border border-black bg-[var(--color-accent)] text-[9px] font-bold text-white"
                  style={{ borderRadius: "var(--border-radius)" }}
                >
                  {c.label}
                </span>
                {c.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
