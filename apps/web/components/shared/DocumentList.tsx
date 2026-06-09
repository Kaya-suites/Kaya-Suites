"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Home, Folder, FileText, ChevronRight, FolderInput } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
  sortOrder?: number;
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
  subfolders?: FolderOption[];
  onSelectFolder?: (id: string) => void;
  onMoveToFolder?: (docId: string, folderId: string | null) => void;
  renderWrapper?: (doc: DocumentSummary, node: React.ReactNode) => React.ReactNode;
  renderFolderWrapper?: (folder: FolderOption, node: React.ReactNode) => React.ReactNode;
  activeId?: string | null;
};

// ── Reorder drop zone ─────────────────────────────────────────────────────────

function ReorderLine({
  id,
  isDoc,
}: {
  id: string;
  isDoc: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: isDoc ? "doc-reorder" : "folder-reorder", dropId: id },
  });

  return (
    <div
      ref={setNodeRef}
      className="h-1 relative -my-0.5"
      style={{ zIndex: isOver ? 10 : undefined }}
    >
      <div
        className={`absolute inset-x-4 top-0 h-0.5 rounded-full transition-all ${
          isOver ? "bg-[var(--color-accent)] opacity-100" : "bg-transparent"
        }`}
      />
    </div>
  );
}

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
      className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg min-w-44 py-1"
      style={{ borderRadius: "var(--radius-md)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-3 py-1 text-[var(--font-size-xs)] font-medium text-[var(--color-text-subtle)] border-b border-[var(--color-border)] mb-1">
        Move to folder
      </p>

      {/* No folder / root */}
      <button
        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors ${
          (currentFolderId ?? null) === null
            ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
            : "hover:bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
        }`}
        onClick={() => { onMove(docId, null); onClose(); }}
      >
        <Home size={11} />
        No folder
      </button>

      {tree.map(({ folder, depth }) => (
        <button
          key={folder.id}
          className={`w-full text-left flex items-center gap-2 text-xs font-medium transition-colors py-1.5 pr-3 ${
            currentFolderId === folder.id
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
              : "hover:bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
          }`}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          onClick={() => { onMove(docId, folder.id); onClose(); }}
        >
          <Folder size={11} className="shrink-0" />
          {folder.name}
        </button>
      ))}

      {folders.length === 0 && (
        <p className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No folders yet</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DocumentList({ documents, loading, folders, subfolders, onSelectFolder, onMoveToFolder, renderWrapper, renderFolderWrapper, activeId }: Props) {
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);

  const isDraggingDoc = activeId?.startsWith("doc:") || activeId?.startsWith("sidebar-doc:");
  const isDraggingFolder = activeId?.startsWith("folder") ?? false;

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
        ))}
      </div>
    );
  }

  const hasContent = (subfolders?.length ?? 0) > 0 || documents.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--color-text-subtle)] gap-3">
        <FileText size={32} strokeWidth={1.5} />
        <p className="text-[var(--font-size-sm)]">No documents yet. Ask Kaya to create one.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {subfolders?.map((folder, idx) => {
        const folderRow = (
          <div key={folder.id} className="group relative flex items-stretch">
            <button
              onClick={() => onSelectFolder?.(folder.id)}
              className="flex-1 flex items-start gap-4 px-6 py-4 hover:bg-[var(--color-bg-subtle)] transition-colors min-w-0 text-left"
            >
              <div className="shrink-0 mt-0.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors">
                <Folder size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--font-size-base)] font-medium text-[var(--color-text)] truncate transition-colors">
                  {folder.name}
                </p>
              </div>
              <div className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] mt-0.5 transition-colors">
                <ChevronRight size={14} />
              </div>
            </button>
          </div>
        );
        return (
          <div key={folder.id}>
            {isDraggingFolder && idx === 0 && (
              <ReorderLine id={`folder-list-before:${folder.id}`} isDoc={false} />
            )}
            {renderFolderWrapper ? renderFolderWrapper(folder, folderRow) : folderRow}
            {isDraggingFolder && (
              <ReorderLine id={`folder-list-after:${folder.id}`} isDoc={false} />
            )}
          </div>
        );
      })}
      {documents.map((doc, idx) => {
        const row = (
          <div className="group relative flex items-stretch">
            <Link
              href={`/documents/${doc.id}`}
              className="flex-1 flex items-start gap-4 px-6 py-4 hover:bg-[var(--color-bg-subtle)] transition-colors min-w-0"
            >
              <div className="shrink-0 mt-0.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors">
                <FileText size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--font-size-base)] font-medium text-[var(--color-text)] truncate transition-colors">
                  {doc.title}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {doc.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                  {doc.lastReviewed && (
                    <span className="text-[var(--font-size-xs)] text-[var(--color-text-subtle)]">
                      Reviewed {doc.lastReviewed}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] mt-0.5 transition-colors">
                <ChevronRight size={14} />
              </div>
            </Link>

            {/* Folder-move button — only rendered when folders feature is active */}
            {onMoveToFolder && folders && (
              <div className="relative shrink-0 flex items-center pr-3">
                <button
                  title="Move to folder"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 border border-transparent hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  style={{ borderRadius: "var(--radius-md)" }}
                  onClick={() => setOpenPickerId(openPickerId === doc.id ? null : doc.id)}
                >
                  <FolderInput size={14} />
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

        return (
          <div key={doc.id}>
            {isDraggingDoc && idx === 0 && (
              <ReorderLine id={`doc-before:${doc.id}`} isDoc={true} />
            )}
            {renderWrapper ? renderWrapper(doc, row) : row}
            {isDraggingDoc && (
              <ReorderLine id={`doc-after:${doc.id}`} isDoc={true} />
            )}
          </div>
        );
      })}
    </div>
  );
}
