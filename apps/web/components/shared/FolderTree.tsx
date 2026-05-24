"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
};

type Props = {
  folders: Folder[];
  documents: DocumentSummary[];
  selectedFolderId: string | null | "root";
  overFolderId?: string | null;
  onSelectFolder: (id: string | null) => void;
  onFolderCreated: (folder: Folder) => void;
  onFolderRenamed: (folder: Folder) => void;
  onFolderDeleted: (id: string) => void;
  onDocumentDeleted: (id: string) => void;
  onDocumentMoved: (docId: string, folderId: string | null) => void;
  onFolderMoved: (folderId: string, newParentId: string | null) => void;
};

// ── Context menu ──────────────────────────────────────────────────────────────

type ContextMenu = {
  folderId: string;
  x: number;
  y: number;
};

type DocKebabMenu = {
  id: string;
  x: number;
  y: number;
};

type DeleteConfirm = {
  id: string;
  name: string;
  docCount: number;
  subFolderCount: number;
};

// ── Kebab icon ────────────────────────────────────────────────────────────────

function KebabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

// ── Draggable folder node ─────────────────────────────────────────────────────

function DraggableFolderNode({
  folder,
  depth,
  folders,
  documents,
  selectedFolderId,
  expandedIds,
  overFolderId,
  onSelectFolder,
  onToggleExpand,
  onContextMenu,
  onDocKebab,
}: {
  folder: Folder;
  depth: number;
  folders: Folder[];
  documents: DocumentSummary[];
  selectedFolderId: string | null | "root";
  expandedIds: Set<string>;
  overFolderId: string | null | undefined;
  onSelectFolder: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, folderId: string) => void;
  onDocKebab: (e: React.MouseEvent, docId: string) => void;
}) {
  const childFolders = folders.filter((f) => f.parentId === folder.id);
  const folderDocs = documents.filter((d) => d.folderId === folder.id);
  const hasChildren = childFolders.length > 0 || folderDocs.length > 0;
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedFolderId === folder.id;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `folder:${folder.id}`,
    data: { type: "folder", folderId: folder.id, parentId: folder.parentId },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `folder-drop:${folder.id}`,
    data: { type: "folder", folderId: folder.id },
  });

  const mergedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const isOver = overFolderId === folder.id && !isDragging;

  function handleRowClick() {
    onSelectFolder(folder.id);
    if (!isExpanded && hasChildren) onToggleExpand(folder.id);
  }

  return (
    <div style={{ opacity: isDragging ? 0.4 : 1 }}>
      {/* Folder row */}
      <div
        ref={mergedRef}
        {...listeners}
        {...attributes}
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-xs font-mono font-bold uppercase tracking-wider transition-colors border-2 ${
          isSelected
            ? "bg-[var(--color-accent)] text-white border-transparent"
            : isOver
            ? "border-[var(--color-accent)] bg-[var(--color-muted-bg)] text-black"
            : "border-transparent text-black hover:bg-[var(--color-muted-bg)]"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleRowClick}
        onContextMenu={(e) => onContextMenu(e, folder.id)}
      >
        <button
          className="shrink-0 w-3 h-3 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(folder.id); }}
        >
          {hasChildren && (
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="currentColor"
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <path d="M2 1l4 3-4 3z" />
            </svg>
          )}
        </button>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span className="truncate flex-1">{folder.name}</span>
        {/* Kebab menu button */}
        <button
          className={`shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded ${
            isSelected ? "text-white/70 hover:text-white hover:bg-white/20" : "text-[var(--color-muted)] hover:text-black hover:bg-black/10"
          }`}
          title="Options"
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, folder.id); }}
        >
          <KebabIcon />
        </button>
      </div>

      {/* Expanded children */}
      {isExpanded && (
        <>
          {childFolders.map((child) => (
            <DraggableFolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              folders={folders}
              documents={documents}
              selectedFolderId={selectedFolderId}
              expandedIds={expandedIds}
              overFolderId={overFolderId}
              onSelectFolder={onSelectFolder}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
              onDocKebab={onDocKebab}
            />
          ))}

          {/* Documents inside this folder — draggable so they can be moved out */}
          {folderDocs.map((doc) => (
            <DraggableFolderDoc key={doc.id} doc={doc} depth={depth} onKebabDoc={onDocKebab} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Draggable doc inside an expanded folder ───────────────────────────────────

function DraggableFolderDoc({
  doc,
  depth,
  onKebabDoc,
}: {
  doc: DocumentSummary;
  depth: number;
  onKebabDoc: (e: React.MouseEvent, docId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc:${doc.id}`,
    data: { type: "document", docId: doc.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="group flex items-center gap-1.5 py-1 cursor-grab select-none border-2 border-transparent hover:bg-[var(--color-muted-bg)] transition-colors"
      style={{ paddingLeft: `${(depth + 1) * 12 + 8}px`, opacity: isDragging ? 0.4 : 1 }}
    >
      <span className="w-3 h-3 shrink-0" />
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-muted)]">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <Link
        href={`/documents/${doc.id}`}
        className="flex-1 truncate text-xs font-mono text-[var(--color-muted)] hover:text-black transition-colors"
        title={doc.title}
        onClick={(e) => e.stopPropagation()}
      >
        {doc.title}
      </Link>
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--color-muted)] hover:text-black"
        title="Options"
        onClick={(e) => { e.stopPropagation(); onKebabDoc(e, doc.id); }}
      >
        <KebabIcon />
      </button>
    </div>
  );
}

// ── Root drop zone ────────────────────────────────────────────────────────────

function RootDropZone({
  selectedFolderId,
  isOver,
  onSelectFolder,
}: {
  selectedFolderId: string | null | "root";
  isOver: boolean;
  onSelectFolder: (id: string | null) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: "folder-drop:root",
    data: { type: "folder", folderId: null },
  });

  const isSelected = selectedFolderId === null;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-xs font-mono font-bold uppercase tracking-wider transition-colors border-2 ${
        isSelected
          ? "bg-[var(--color-accent)] text-white border-transparent"
          : isOver
          ? "border-[var(--color-accent)] bg-[var(--color-muted-bg)] text-black"
          : "border-transparent text-black hover:bg-[var(--color-muted-bg)]"
      }`}
      onClick={() => onSelectFolder(null)}
    >
      <span className="w-3 h-3 shrink-0" />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <span>All documents</span>
    </div>
  );
}

// ── Unfiled document row (draggable) ──────────────────────────────────────────

function UnfiledDocRow({
  doc,
  onKebabDoc,
}: {
  doc: DocumentSummary;
  onKebabDoc: (e: React.MouseEvent, docId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc:${doc.id}`,
    data: { type: "document", docId: doc.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="group flex items-center gap-1.5 py-1 cursor-grab select-none border-2 border-transparent hover:bg-[var(--color-muted-bg)] transition-colors"
      style={{ paddingLeft: "20px", opacity: isDragging ? 0.4 : 1 }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-muted)]">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <Link
        href={`/documents/${doc.id}`}
        className="flex-1 truncate text-xs font-mono text-[var(--color-muted)] hover:text-black transition-colors"
        title={doc.title}
        onClick={(e) => e.stopPropagation()}
      >
        {doc.title}
      </Link>
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--color-muted)] hover:text-black"
        title="Options"
        onClick={(e) => { e.stopPropagation(); onKebabDoc(e, doc.id); }}
      >
        <KebabIcon />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FolderTree({
  folders,
  documents,
  selectedFolderId,
  overFolderId,
  onSelectFolder,
  onFolderCreated,
  onFolderRenamed,
  onFolderDeleted,
  onDocumentDeleted,
  onDocumentMoved,
  onFolderMoved,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [docKebabMenu, setDocKebabMenu] = useState<DocKebabMenu | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleContextMenu(e: React.MouseEvent, folderId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDocKebabMenu(null);
    setContextMenu({ folderId, x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function closeAll() {
    setContextMenu(null);
    setDocKebabMenu(null);
  }

  function openDocKebab(e: React.MouseEvent, docId: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDocKebabMenu({ id: docId, x: rect.left, y: rect.bottom + 4 });
  }

  function startRename(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    if (folder) setRenaming({ id: folderId, name: folder.name });
    closeContextMenu();
  }

  async function submitRename() {
    if (!renaming || !renaming.name.trim()) { setRenaming(null); return; }
    try {
      const res = await fetch(`/api/folders/${renaming.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renaming.name.trim() }),
      });
      if (res.ok) {
        const updated = await res.json() as Folder;
        onFolderRenamed(updated);
      }
    } catch {}
    setRenaming(null);
  }

  async function deleteFolder(folderId: string) {
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (res.ok || res.status === 204) onFolderDeleted(folderId);
    } catch {}
  }

  function confirmDeleteFolder(folderId: string) {
    closeContextMenu();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    // Collect all descendant folder IDs (BFS)
    const allIds = new Set<string>();
    const queue = [folderId];
    while (queue.length) {
      const cur = queue.pop()!;
      allIds.add(cur);
      folders.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
    }

    const docCount = documents.filter((d) => d.folderId && allIds.has(d.folderId)).length;
    const subFolderCount = allIds.size - 1;

    if (docCount === 0 && subFolderCount === 0) {
      deleteFolder(folderId);
      return;
    }

    setDeleteConfirm({ id: folderId, name: folder.name, docCount, subFolderCount });
  }

  async function deleteDocument(docId: string) {
    setDocKebabMenu(null);
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (res.ok || res.status === 204) onDocumentDeleted(docId);
    } catch {}
  }

  function startCreate(parentId: string | null) {
    setCreating({ parentId });
    setNewFolderName("");
    closeContextMenu();
  }

  async function submitCreate() {
    if (!creating || !newFolderName.trim()) { setCreating(null); return; }
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), parentId: creating.parentId }),
      });
      if (res.ok || res.status === 201) {
        const folder = await res.json() as Folder;
        onFolderCreated(folder);
        if (creating.parentId) {
          setExpandedIds((prev) => new Set([...prev, creating.parentId!]));
        }
      }
    } catch {}
    setCreating(null);
    setNewFolderName("");
  }

  const rootFolders = folders.filter((f) => f.parentId === null);
  const unfiledDocs = documents.filter((d) => !d.folderId);

  return (
    <div className="relative" onClick={closeAll}>
      <div className="py-1">
        <div className="px-2 py-1 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] font-mono">Folders</span>
          <button
            onClick={(e) => { e.stopPropagation(); startCreate(null); }}
            className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
            title="New folder"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <RootDropZone
          selectedFolderId={selectedFolderId}
          isOver={overFolderId === null}
          onSelectFolder={onSelectFolder}
        />

        {rootFolders.map((folder) => (
          <DraggableFolderNode
            key={folder.id}
            folder={folder}
            depth={0}
            folders={folders}
            documents={documents}
            selectedFolderId={selectedFolderId}
            expandedIds={expandedIds}
            overFolderId={overFolderId}
            onSelectFolder={onSelectFolder}
            onToggleExpand={toggleExpand}
            onContextMenu={handleContextMenu}
            onDocKebab={openDocKebab}
          />
        ))}

        {creating && (
          <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: creating.parentId ? "24px" : "8px" }}>
            <span className="w-3 h-3 shrink-0" />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-accent)]">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <input
              ref={createRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreate();
                if (e.key === "Escape") setCreating(null);
              }}
              onBlur={submitCreate}
              className="flex-1 text-xs font-mono font-bold uppercase tracking-wider border-b-2 border-[var(--color-accent)] bg-transparent outline-none text-black py-0.5"
              placeholder="Folder name"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {unfiledDocs.map((doc) => (
          <UnfiledDocRow key={doc.id} doc={doc} onKebabDoc={openDocKebab} />
        ))}
      </div>

      {/* Folder right-click / kebab context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border-2 border-black shadow-lg py-1 min-w-36"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:bg-[var(--color-muted-bg)] transition-colors"
            onClick={() => startCreate(contextMenu.folderId)}
          >
            New subfolder
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:bg-[var(--color-muted-bg)] transition-colors"
            onClick={() => startRename(contextMenu.folderId)}
          >
            Rename
          </button>
          <div className="border-t border-black my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:bg-[var(--color-danger)] hover:text-white transition-colors text-[var(--color-danger)]"
            onClick={() => confirmDeleteFolder(contextMenu.folderId)}
          >
            Delete folder
          </button>
        </div>
      )}

      {/* Document kebab menu */}
      {docKebabMenu && (
        <div
          className="fixed z-50 bg-white border-2 border-black shadow-lg py-1 min-w-36"
          style={{ top: docKebabMenu.y, left: docKebabMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:bg-[var(--color-danger)] hover:text-white transition-colors text-[var(--color-danger)]"
            onClick={() => deleteDocument(docKebabMenu.id)}
          >
            Delete document
          </button>
        </div>
      )}

      {/* Folder rename inline input */}
      {renaming && (
        <div className="px-2 py-1">
          <input
            ref={renameRef}
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={submitRename}
            className="w-full text-xs font-mono font-bold uppercase tracking-wider border-2 border-[var(--color-accent)] bg-white outline-none px-2 py-1 text-black"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Folder delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-white border-2 border-black shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-bold uppercase tracking-wider font-mono mb-3">
              Delete folder
            </h2>
            <p className="text-xs font-mono text-black mb-2">
              Delete <span className="font-bold">&ldquo;{deleteConfirm.name}&rdquo;</span>?
            </p>
            <p className="text-xs font-mono text-[var(--color-danger)] mb-5">
              This will permanently delete{" "}
              {deleteConfirm.docCount > 0 && (
                <span>
                  <span className="font-bold">{deleteConfirm.docCount}</span>{" "}
                  document{deleteConfirm.docCount !== 1 ? "s" : ""}
                  {deleteConfirm.subFolderCount > 0 ? " and " : ""}
                </span>
              )}
              {deleteConfirm.subFolderCount > 0 && (
                <span>
                  <span className="font-bold">{deleteConfirm.subFolderCount}</span>{" "}
                  subfolder{deleteConfirm.subFolderCount !== 1 ? "s" : ""}
                </span>
              )}{" "}
              inside it. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider font-mono border-2 border-black hover:bg-[var(--color-muted-bg)] transition-colors"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider font-mono border-2 border-black bg-[var(--color-danger)] text-white hover:opacity-90 transition-opacity"
                onClick={() => {
                  deleteFolder(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Draggable document wrapper (used by documents page main list) ──────────────

export function DraggableDocument({
  docId,
  children,
}: {
  docId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc:${docId}`,
    data: { type: "document", docId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
    </div>
  );
}

// ── Draggable folder wrapper (used by documents page main list) ────────────────

export function DraggableFolder({
  folderId,
  parentId,
  children,
}: {
  folderId: string;
  parentId: string | null;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `folder-main:${folderId}`,
    data: { type: "folder", folderId, parentId },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}>
      {children}
    </div>
  );
}
