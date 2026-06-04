"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { MoreVertical, ChevronRight, Folder, FileText, Home, FilePlus, ChevronLeft, Plus } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
  sortOrder?: number;
};

type Props = {
  folders: Folder[];
  documents: DocumentSummary[];
  selectedFolderId: string | null | "root";
  overDropTarget?: FolderDropTarget;
  activeId?: string | null;
  onSelectFolder: (id: string | null) => void;
  onFolderCreated: (folder: Folder) => void;
  onFolderRenamed: (folder: Folder) => void;
  onFolderDeleted: (id: string) => void;
  onDocumentCreated: (doc: DocumentSummary) => void;
  onDocumentDeleted: (id: string) => void;
  onCollapse?: () => void;
};

export type FolderDropTarget =
  | { kind: "inside"; folderId: string }
  | { kind: "before"; folderId: string; parentId: string | null }
  | { kind: "after"; folderId: string; parentId: string | null }
  | { kind: "root" };

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

type FolderSidebarState = {
  expandedFolderIds: string[];
};

const EXPANDED_FOLDERS_STORAGE_KEY = "kaya_folder_sidebar_expanded_v1";

function sortFoldersForTree(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const name = a.name.localeCompare(b.name);
    if (name !== 0) return name;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function sortDocumentsForTree(documents: DocumentSummary[]): DocumentSummary[] {
  return [...documents].sort((a, b) => {
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    return a.id.localeCompare(b.id);
  });
}

// ── Kebab icon ────────────────────────────────────────────────────────────────

function KebabIcon() {
  return <MoreVertical size={12} />;
}

// ── Draggable folder node ─────────────────────────────────────────────────────

function DraggableFolderNode({
  folder,
  depth,
  folders,
  documents,
  selectedFolderId,
  expandedIds,
  overDropTarget,
  onSelectFolder,
  onToggleExpand,
  onContextMenu,
  onDocKebab,
  isDraggingDoc,
}: {
  folder: Folder;
  depth: number;
  folders: Folder[];
  documents: DocumentSummary[];
  selectedFolderId: string | null | "root";
  expandedIds: Set<string>;
  overDropTarget: FolderDropTarget | undefined;
  onSelectFolder: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, folderId: string) => void;
  onDocKebab: (e: React.MouseEvent, docId: string) => void;
  isDraggingDoc: boolean;
}) {
  const childFolders = sortFoldersForTree(folders.filter((f) => f.parentId === folder.id));
  const folderDocs = sortDocumentsForTree(documents.filter((d) => d.folderId === folder.id));
  const hasChildren = childFolders.length > 0 || folderDocs.length > 0;
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedFolderId === folder.id;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `folder:${folder.id}`,
    data: { type: "folder", folderId: folder.id, parentId: folder.parentId },
  });

  const { setNodeRef: setInsideDropRef } = useDroppable({
    id: `folder-drop:${folder.id}`,
    data: { type: "folder-target", dropType: "inside", folderId: folder.id },
  });

  const { setNodeRef: setBeforeDropRef } = useDroppable({
    id: `folder-before:${folder.id}`,
    data: { type: "folder-target", dropType: "before", folderId: folder.id, parentId: folder.parentId },
  });

  const { setNodeRef: setAfterDropRef } = useDroppable({
    id: `folder-after:${folder.id}`,
    data: { type: "folder-target", dropType: "after", folderId: folder.id, parentId: folder.parentId },
  });

  const mergedRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setInsideDropRef(node);
  };

  const isOverInside =
    overDropTarget?.kind === "inside" && overDropTarget.folderId === folder.id && !isDragging;
  const isOverBefore =
    overDropTarget?.kind === "before" && overDropTarget.folderId === folder.id && !isDragging;
  const isOverAfter =
    overDropTarget?.kind === "after" && overDropTarget.folderId === folder.id && !isDragging;

  function handleRowClick() {
    onSelectFolder(folder.id);
    if (!isExpanded && hasChildren) onToggleExpand(folder.id);
  }

  return (
    <div style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div
        ref={setBeforeDropRef}
        className="px-2"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <div
          className={`h-0.5 rounded-full transition-colors ${
            isOverBefore ? "bg-[var(--color-accent)]" : "bg-transparent"
          }`}
        />
      </div>

      {/* Folder row */}
      <div
        ref={mergedRef}
        {...listeners}
        {...attributes}
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-xs font-mono font-bold uppercase tracking-wider transition-colors border-2 ${
          isSelected
            ? "bg-[var(--color-accent)] text-white border-transparent"
            : isOverInside
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
            <ChevronRight
              size={10}
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            />
          )}
        </button>
        <Folder size={12} className="shrink-0" />
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
              overDropTarget={overDropTarget}
              onSelectFolder={onSelectFolder}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
              onDocKebab={onDocKebab}
              isDraggingDoc={isDraggingDoc}
            />
          ))}

          {/* Documents inside this folder — draggable and reorderable */}
          {folderDocs.map((doc, idx) => (
            <div key={doc.id}>
              {isDraggingDoc && idx === 0 && (
                <SidebarDocReorderLine id={`doc-before:${doc.id}`} depth={depth + 1} />
              )}
              <DraggableFolderDoc doc={doc} depth={depth} onKebabDoc={onDocKebab} />
              {isDraggingDoc && (
                <SidebarDocReorderLine id={`doc-after:${doc.id}`} depth={depth + 1} />
              )}
            </div>
          ))}
        </>
      )}

      <div
        ref={setAfterDropRef}
        className="px-2"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <div
          className={`h-0.5 rounded-full transition-colors ${
            isOverAfter ? "bg-[var(--color-accent)]" : "bg-transparent"
          }`}
        />
      </div>
    </div>
  );
}

// ── Sidebar document reorder target ──────────────────────────────────────────

function SidebarDocReorderLine({
  id,
  depth,
}: {
  id: string;
  depth: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "doc-reorder", dropId: id },
  });

  return (
    <div ref={setNodeRef} className="px-2" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
      <div
        className={`h-0.5 rounded-full transition-colors ${
          isOver ? "bg-[var(--color-accent)]" : "bg-transparent"
        }`}
      />
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
    id: `sidebar-doc:${doc.id}`,
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
      <FileText size={11} className="shrink-0 text-[var(--color-muted)]" />
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
    data: { type: "folder-target", dropType: "root" },
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
      <Home size={12} className="shrink-0" />
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
    id: `sidebar-doc:${doc.id}`,
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
      <FileText size={11} className="shrink-0 text-[var(--color-muted)]" />
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
  overDropTarget,
  activeId,
  onSelectFolder,
  onFolderCreated,
  onFolderRenamed,
  onFolderDeleted,
  onDocumentCreated,
  onDocumentDeleted,
  onCollapse,
}: Props) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [docKebabMenu, setDocKebabMenu] = useState<DocKebabMenu | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const docKebabMenuRef = useRef<HTMLDivElement>(null);
  const savePreferencesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingDoc = activeId?.startsWith("doc:") || activeId?.startsWith("sidebar-doc:") || false;
  const activeFolderId = activeId?.startsWith("folder")
    ? (activeId.startsWith("folder-main:") ? activeId.slice(12) : activeId.slice(7))
    : null;

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    let cancelled = false;

    async function loadExpandedFolders() {
      let hadLocalState = false;

      try {
        const raw = window.localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed)) {
            hadLocalState = true;
            if (!cancelled) setExpandedIds(new Set(parsed));
          }
        }
      } catch {}

      try {
        const res = await fetch("/api/preferences/folder-sidebar");
        if (!res.ok) return;
        const state = await res.json() as FolderSidebarState;
        if (!cancelled && !hadLocalState && Array.isArray(state.expandedFolderIds)) {
          setExpandedIds(new Set(state.expandedFolderIds));
        }
      } catch {
        // Local state is the first source of truth; server sync is best-effort.
      } finally {
        if (!cancelled) setPreferencesReady(true);
      }
    }

    void loadExpandedFolders();

    return () => {
      cancelled = true;
      if (savePreferencesTimerRef.current) clearTimeout(savePreferencesTimerRef.current);
      if (hoverExpandTimerRef.current) clearTimeout(hoverExpandTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;

    const expandedFolderIds = Array.from(expandedIds).sort();

    try {
      window.localStorage.setItem(
        EXPANDED_FOLDERS_STORAGE_KEY,
        JSON.stringify(expandedFolderIds),
      );
    } catch {}

    if (savePreferencesTimerRef.current) clearTimeout(savePreferencesTimerRef.current);
    savePreferencesTimerRef.current = setTimeout(() => {
      void fetch("/api/preferences/folder-sidebar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expandedFolderIds }),
      }).catch(() => {});
    }, 300);

    return () => {
      if (savePreferencesTimerRef.current) clearTimeout(savePreferencesTimerRef.current);
    };
  }, [expandedIds, preferencesReady]);

  useEffect(() => {
    const hoveredFolderId = overDropTarget?.kind === "inside" ? overDropTarget.folderId : null;
    const isDraggingFolder = activeFolderId !== null;

    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }

    if (!hoveredFolderId || expandedIds.has(hoveredFolderId)) return;
    if (!isDraggingDoc && !isDraggingFolder) return;
    if (hoveredFolderId === activeFolderId) return;

    hoverExpandTimerRef.current = setTimeout(() => {
      setExpandedIds((prev) => {
        if (prev.has(hoveredFolderId)) return prev;
        return new Set([...prev, hoveredFolderId]);
      });
      hoverExpandTimerRef.current = null;
    }, 500);

    return () => {
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = null;
      }
    };
  }, [activeFolderId, expandedIds, isDraggingDoc, overDropTarget]);

  useEffect(() => {
    if (!contextMenu && !docKebabMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      if (docKebabMenuRef.current?.contains(target)) return;
      closeAll();
    }

    function handleContextMenuOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      if (docKebabMenuRef.current?.contains(target)) return;
      closeAll();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenuOutside, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("contextmenu", handleContextMenuOutside, true);
    };
  }, [contextMenu, docKebabMenu]);

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

  async function createDocument(folderId: string | null) {
    closeAll();
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled",
          content: "",
          tags: [],
          folder_id: folderId,
        }),
      });
      if (!res.ok) return;
      const created = await res.json() as {
        id: string;
        title: string;
        tags?: string[];
        folderId?: string | null;
        lastReviewed?: string;
      };
      onDocumentCreated({
        id: created.id,
        title: created.title,
        tags: created.tags ?? [],
        folderId: created.folderId ?? folderId,
        lastReviewed: created.lastReviewed,
      });
      router.push(`/documents/${created.id}`);
    } catch {}
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

  const rootFolders = sortFoldersForTree(folders.filter((f) => f.parentId === null));
  const unfiledDocs = sortDocumentsForTree(documents.filter((d) => !d.folderId));

  return (
    <div className="relative" onClick={closeAll}>
      <div className="py-1">
        <div className="px-2 py-1 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-muted)] font-mono">Folders</span>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                createDocument(
                  selectedFolderId && selectedFolderId !== "root" ? selectedFolderId : null,
                );
              }}
              className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
              title="New file"
            >
              <FilePlus size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); startCreate(null); }}
              className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
              title="New folder"
            >
              <Plus size={12} strokeWidth={2.5} />
            </button>
            {onCollapse && (
              <button
                onClick={(e) => { e.stopPropagation(); onCollapse(); }}
                title="Hide folder sidebar"
                className="w-7 h-7 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                style={{ boxShadow: "var(--shadow-button)" }}
              >
                <ChevronLeft size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <RootDropZone
          selectedFolderId={selectedFolderId}
          isOver={overDropTarget?.kind === "root"}
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
            overDropTarget={overDropTarget}
            onSelectFolder={onSelectFolder}
            onToggleExpand={toggleExpand}
            onContextMenu={handleContextMenu}
            onDocKebab={openDocKebab}
            isDraggingDoc={isDraggingDoc}
          />
        ))}

        {creating && (
          <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: creating.parentId ? "24px" : "8px" }}>
            <span className="w-3 h-3 shrink-0" />
            <Folder size={12} className="shrink-0 text-[var(--color-accent)]" />
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

        {unfiledDocs.map((doc, idx) => (
          <div key={doc.id}>
            {isDraggingDoc && idx === 0 && (
              <SidebarDocReorderLine id={`doc-before:${doc.id}`} depth={1} />
            )}
            <UnfiledDocRow doc={doc} onKebabDoc={openDocKebab} />
            {isDraggingDoc && (
              <SidebarDocReorderLine id={`doc-after:${doc.id}`} depth={1} />
            )}
          </div>
        ))}
      </div>

      {/* Folder right-click / kebab context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border-2 border-black shadow-lg py-1 min-w-36"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:bg-[var(--color-muted-bg)] transition-colors"
            onClick={() => createDocument(contextMenu.folderId)}
          >
            New file
          </button>
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
          ref={docKebabMenuRef}
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
