"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
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
  onSelectFolder: (id: string | null) => void;
  onFolderCreated: (folder: Folder) => void;
  onFolderRenamed: (folder: Folder) => void;
  onFolderDeleted: (id: string) => void;
  onDocumentMoved: (docId: string, folderId: string | null) => void;
  onFolderMoved: (folderId: string, newParentId: string | null) => void;
};

// ── Context menu ──────────────────────────────────────────────────────────────

type ContextMenu = {
  folderId: string;
  x: number;
  y: number;
};

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
  onDeleteFolder,
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
  onDeleteFolder: (folderId: string) => void;
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

  // Highlight when another item is hovering over this folder (not itself).
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
        <button
          className={`shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded ${
            isSelected ? "hover:bg-white/20 text-white" : "hover:bg-[var(--color-danger)] hover:text-white text-[var(--color-muted)]"
          }`}
          title={`Delete "${folder.name}"`}
          onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
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
              onDeleteFolder={onDeleteFolder}
            />
          ))}

          {/* Documents inside this folder — draggable so they can be moved out */}
          {folderDocs.map((doc) => (
            <DraggableFolderDoc key={doc.id} doc={doc} depth={depth} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Draggable doc inside an expanded folder ───────────────────────────────────

function DraggableFolderDoc({ doc, depth }: { doc: DocumentSummary; depth: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc:${doc.id}`,
    data: { type: "document", docId: doc.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex items-center gap-1.5 py-1 cursor-grab select-none border-2 border-transparent hover:bg-[var(--color-muted-bg)] transition-colors"
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

function UnfiledDocRow({ doc }: { doc: DocumentSummary }) {
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
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FolderTree({
  folders,
  documents,
  selectedFolderId,
  onSelectFolder,
  onFolderCreated,
  onFolderRenamed,
  onFolderDeleted,
  onDocumentMoved,
  onFolderMoved,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  // folderId the pointer is currently over (null = root zone, undefined = nothing).
  const [overFolderId, setOverFolderId] = useState<string | null | undefined>(undefined);
  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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
    setContextMenu({ folderId, x: e.clientX, y: e.clientY });
  }

  function closeContextMenu() {
    setContextMenu(null);
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
    closeContextMenu();
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (res.ok || res.status === 204) onFolderDeleted(folderId);
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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setOverFolderId(undefined);
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) { setOverFolderId(undefined); return; }
    const data = over.data.current as { folderId?: string | null };
    setOverFolderId(data?.folderId !== undefined ? data.folderId : undefined);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverFolderId(undefined);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { type: string; folderId?: string; docId?: string };
    const overData = over.data.current as { folderId?: string | null };
    const targetFolderId = overData?.folderId !== undefined ? overData.folderId : null;

    if (activeData.type === "folder" && activeData.folderId) {
      if (activeData.folderId === targetFolderId) return; // can't nest into itself
      try {
        const res = await fetch(`/api/folders/${activeData.folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: targetFolderId }),
        });
        if (res.ok) {
          const updated = await res.json() as Folder;
          onFolderMoved(activeData.folderId, updated.parentId);
        }
      } catch {}
    } else if (activeData.type === "document" && activeData.docId) {
      try {
        const res = await fetch(`/api/documents/${activeData.docId}/folder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: targetFolderId }),
        });
        if (res.ok || res.status === 204) {
          onDocumentMoved(activeData.docId, targetFolderId);
        }
      } catch {}
    }
  }

  const rootFolders = folders.filter((f) => f.parentId === null);
  const unfiledDocs = documents.filter((d) => !d.folderId);

  const activeFolderName = activeId?.startsWith("folder:")
    ? folders.find((f) => f.id === activeId.slice(7))?.name
    : null;
  const activeDoc = activeId?.startsWith("doc:")
    ? documents.find((d) => d.id === activeId.slice(4))
    : null;

  return (
    <div className="relative" onClick={() => closeContextMenu()}>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          const hits = pointerWithin(args);
          return hits.length > 0 ? hits : closestCenter(args);
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
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
              onDeleteFolder={deleteFolder}
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
            <UnfiledDocRow key={doc.id} doc={doc} />
          ))}
        </div>

        <DragOverlay>
          {activeFolderName && (
            <div className="text-xs font-mono font-bold uppercase tracking-wider px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90">
              {activeFolderName}
            </div>
          )}
          {activeDoc && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90 text-xs font-mono text-[var(--color-muted)]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="truncate max-w-32">{activeDoc.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

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
            onClick={() => deleteFolder(contextMenu.folderId)}
          >
            Delete folder
          </button>
        </div>
      )}

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
