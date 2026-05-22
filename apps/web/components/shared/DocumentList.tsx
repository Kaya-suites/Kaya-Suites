"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
};

type FolderOption = {
  id: string;
  name: string;
  parentId: string | null;
};

type Props = {
  documents: DocumentSummary[];
  loading: boolean;
  folders?: FolderOption[];
  onMoveToFolder?: (docId: string, folderId: string | null) => void;
  renderWrapper?: (doc: DocumentSummary, node: React.ReactNode) => React.ReactNode;
};

// ── Folder picker popover ─────────────────────────────────────────────────────

function FolderPicker({
  docId,
  currentFolderId,
  folders,
  onMove,
  onClose,
}: {
  docId: string;
  currentFolderId: string | null | undefined;
  folders: FolderOption[];
  onMove: (docId: string, folderId: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Build a flat ordered list with depth info for visual indentation.
  function buildTree(parentId: string | null, depth: number): { folder: FolderOption; depth: number }[] {
    return folders
      .filter((f) => f.parentId === parentId)
      .flatMap((f) => [{ folder: f, depth }, ...buildTree(f.id, depth + 1)]);
  }
  const tree = buildTree(null, 0);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white border-2 border-black shadow-lg min-w-44 py-1"
      style={{ borderRadius: "var(--border-radius)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] font-mono border-b border-black mb-1">
        Move to folder
      </p>

      {/* No folder / root */}
      <button
        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
          (currentFolderId ?? null) === null
            ? "bg-[var(--color-accent)] text-white"
            : "hover:bg-[var(--color-muted-bg)] text-black"
        }`}
        onClick={() => { onMove(docId, null); onClose(); }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        No folder
      </button>

      {tree.map(({ folder, depth }) => (
        <button
          key={folder.id}
          className={`w-full text-left flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider transition-colors py-1.5 pr-3 ${
            currentFolderId === folder.id
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-muted-bg)] text-black"
          }`}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          onClick={() => { onMove(docId, folder.id); onClose(); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          {folder.name}
        </button>
      ))}

      {folders.length === 0 && (
        <p className="px-3 py-2 text-xs font-mono text-[var(--color-muted)]">No folders yet</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DocumentList({ documents, loading, folders, onMoveToFolder, renderWrapper }: Props) {
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ borderRadius: "var(--border-radius)" }} />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--color-muted)] text-sm gap-3 font-mono">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p className="uppercase tracking-wider text-xs font-bold">No documents yet. Ask Kaya to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y-2 divide-black">
      {documents.map((doc) => {
        const row = (
          <div key={doc.id} className="group relative flex items-stretch">
            <Link
              href={`/documents/${doc.id}`}
              className="flex-1 flex items-start gap-4 px-6 py-4 hover:bg-[var(--color-muted-bg)] transition-colors min-w-0"
            >
              <div className="shrink-0 mt-0.5 text-[var(--color-muted)] group-hover:text-[var(--color-accent)] transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-black group-hover:text-[var(--color-accent)] truncate transition-colors font-mono">
                  {doc.title}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {doc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 border-2 border-black text-black text-xs font-bold uppercase font-mono"
                      style={{ borderRadius: "var(--border-radius)" }}
                    >
                      {tag}
                    </span>
                  ))}
                  {doc.lastReviewed && (
                    <span className="text-xs text-[var(--color-muted)] font-mono">
                      Reviewed {doc.lastReviewed}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-[var(--color-muted)] group-hover:text-black mt-0.5 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>

            {/* Folder-move button — only rendered when folders feature is active */}
            {onMoveToFolder && folders && (
              <div className="relative shrink-0 flex items-center pr-3">
                <button
                  title="Move to folder"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 border-2 border-transparent hover:border-black hover:bg-[var(--color-muted-bg)] text-[var(--color-muted)] hover:text-black"
                  style={{ borderRadius: "var(--border-radius)" }}
                  onClick={() => setOpenPickerId(openPickerId === doc.id ? null : doc.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>

                {openPickerId === doc.id && (
                  <FolderPicker
                    docId={doc.id}
                    currentFolderId={doc.folderId}
                    folders={folders}
                    onMove={onMoveToFolder}
                    onClose={() => setOpenPickerId(null)}
                  />
                )}
              </div>
            )}
          </div>
        );

        return renderWrapper ? renderWrapper(doc, row) : row;
      })}
    </div>
  );
}
