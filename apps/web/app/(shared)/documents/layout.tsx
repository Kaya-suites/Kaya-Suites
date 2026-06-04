"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  FolderTree,
  type Folder,
  type DocumentSummary,
  type FolderDropTarget,
} from "@/components/shared/FolderTree";
import { ChevronRight, Folder as FolderIcon, FileText } from "lucide-react";
import { useResizable } from "@/hooks/useResizable";
import { DocumentsContext } from "./context";

// ── Helpers ───────────────────────────────────────────────────────────────────

type FolderDropData =
  | { type: "folder-target"; dropType: "inside"; folderId: string }
  | { type: "folder-target"; dropType: "before" | "after"; folderId: string; parentId: string | null }
  | { type: "folder-target"; dropType: "root" };

function getFolderDropTarget(data: unknown): FolderDropTarget | undefined {
  if (!data || typeof data !== "object" || !("type" in data)) return undefined;
  const d = data as FolderDropData;
  if (d.type !== "folder-target") return undefined;
  if (d.dropType === "root") return { kind: "root" };
  if (d.dropType === "inside") return { kind: "inside", folderId: d.folderId };
  return { kind: d.dropType, folderId: d.folderId, parentId: d.parentId };
}

function sortFoldersForRender(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => {
    const p = (a.parentId ?? "").localeCompare(b.parentId ?? "");
    if (p !== 0) return p;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function getSiblingFolders(folders: Folder[], parentId: string | null, excludeId?: string): Folder[] {
  return sortFoldersForRender(folders).filter(
    (f) => f.parentId === parentId && f.id !== excludeId,
  );
}

function sortDocumentsForRender(documents: DocumentSummary[]): DocumentSummary[] {
  return [...documents].sort((a, b) => {
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    return a.id.localeCompare(b.id);
  });
}

function getSiblingDocuments(
  documents: DocumentSummary[],
  folderId: string | null,
  excludeId?: string,
): DocumentSummary[] {
  return sortDocumentsForRender(documents).filter(
    (d) => (d.folderId ?? null) === folderId && d.id !== excludeId,
  );
}

function applyDocumentMove(
  documents: DocumentSummary[],
  docId: string,
  targetFolderId: string | null,
  orderIndex: number,
): DocumentSummary[] {
  const moving = documents.find((d) => d.id === docId);
  if (!moving) return documents;

  const sourceFolderId = moving.folderId ?? null;
  const targetSiblings = getSiblingDocuments(documents, targetFolderId, docId);
  const insertAt = Math.max(0, Math.min(orderIndex, targetSiblings.length));
  const reorderedTarget = [...targetSiblings];
  reorderedTarget.splice(insertAt, 0, { ...moving, folderId: targetFolderId });

  const targetOrders = new Map(reorderedTarget.map((d, i) => [d.id, i]));
  const sourceOrders =
    sourceFolderId === targetFolderId
      ? new Map<string, number>()
      : new Map(getSiblingDocuments(documents, sourceFolderId, docId).map((d, i) => [d.id, i]));

  return documents.map((d) => {
    if (d.id === docId) {
      return {
        ...d,
        folderId: targetFolderId,
        sortOrder: targetOrders.get(d.id) ?? insertAt,
      };
    }
    if (targetOrders.has(d.id)) {
      return { ...d, sortOrder: targetOrders.get(d.id)! };
    }
    if (sourceOrders.has(d.id)) {
      return { ...d, sortOrder: sourceOrders.get(d.id)! };
    }
    return d;
  });
}

function applyFolderMove(
  folders: Folder[],
  folderId: string,
  newParentId: string | null,
  orderIndex: number,
): Folder[] {
  const moving = folders.find((f) => f.id === folderId);
  if (!moving) return folders;

  const targetSiblings = getSiblingFolders(folders, newParentId, folderId);
  const insertAt = Math.max(0, Math.min(orderIndex, targetSiblings.length));
  const reorderedTarget = [...targetSiblings];
  reorderedTarget.splice(insertAt, 0, { ...moving, parentId: newParentId });

  const targetOrders = new Map(reorderedTarget.map((f, i) => [f.id, i]));
  const prevOrders =
    moving.parentId === newParentId
      ? new Map<string, number>()
      : new Map(getSiblingFolders(folders, moving.parentId, folderId).map((f, i) => [f.id, i]));

  return sortFoldersForRender(
    folders.map((f) => {
      if (f.id === folderId) return { ...f, parentId: newParentId, sortOrder: targetOrders.get(f.id) ?? insertAt };
      if (targetOrders.has(f.id)) return { ...f, sortOrder: targetOrders.get(f.id)! };
      if (prevOrders.has(f.id)) return { ...f, sortOrder: prevOrders.get(f.id)! };
      return f;
    }),
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overDropTarget, setOverDropTarget] = useState<FolderDropTarget | undefined>(undefined);

  const [folderSidebarCollapsed, setFolderSidebarCollapsed] = useState(false);
  const { width: sidebarWidth, onMouseDown: onResizeStart } = useResizable("documents-sidebar-width", 200);

  useEffect(() => {
    if (window.innerWidth < 640) setFolderSidebarCollapsed(true);
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    Promise.all([
      fetch("/api/folders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/documents").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([foldersData, docsData]: [Folder[], DocumentSummary[]]) => {
        setFolders(sortFoldersForRender(foldersData));
        setDocuments(docsData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const onFolderCreated = useCallback((folder: Folder) => {
    setFolders((prev) => sortFoldersForRender([...prev, folder]));
  }, []);

  const onFolderRenamed = useCallback((folder: Folder) => {
    setFolders((prev) => sortFoldersForRender(prev.map((f) => (f.id === folder.id ? { ...f, ...folder } : f))));
  }, []);

  const onFolderDeleted = useCallback((id: string) => {
    setFolders((prev) => {
      const toDelete = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const cur = queue.pop()!;
        toDelete.add(cur);
        prev.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
      }
      setDocuments((docs) => docs.filter((d) => !d.folderId || !toDelete.has(d.folderId)));
      return prev.filter((f) => !toDelete.has(f.id));
    });
    setSelectedFolderId((cur) => (cur === id ? null : cur));
  }, []);

  const onDocumentCreated = useCallback((doc: DocumentSummary) => {
    setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
  }, []);

  const onDocumentDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const onDocumentMoved = useCallback((docId: string, folderId: string | null, orderIndex?: number) => {
    setDocuments((prev) => {
      const targetIndex = orderIndex ?? getSiblingDocuments(prev, folderId, docId).length;
      return applyDocumentMove(prev, docId, folderId, targetIndex);
    });
  }, []);

  const onFolderMoved = useCallback((folderId: string, newParentId: string | null, orderIndex: number) => {
    setFolders((prev) => applyFolderMove(prev, folderId, newParentId, orderIndex));
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setOverDropTarget(undefined);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverDropTarget(getFolderDropTarget(event.over?.data.current));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverDropTarget(undefined);
    const { active, over } = event;
    const activeData = active.data.current as {
      type: string;
      docId?: string;
      folderId?: string;
      parentId?: string | null;
    };

    if (!over) {
      if (activeData.type === "folder" && activeData.folderId) {
        if (activeData.parentId == null) return;
        const targetIndex = getSiblingFolders(folders, null, activeData.folderId).length;
        try {
          const res = await fetch(`/api/folders/${activeData.folderId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentId: null, orderIndex: targetIndex }),
          });
          if (res.ok) onFolderMoved(activeData.folderId, null, targetIndex);
        } catch {}
      } else if (activeData.type === "document" && activeData.docId) {
        const doc = documents.find((d) => d.id === activeData.docId);
        if (!doc?.folderId) return;
        try {
          const res = await fetch(`/api/documents/${activeData.docId}/folder`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: null }),
          });
          if (res.ok || res.status === 204) onDocumentMoved(activeData.docId, null);
        } catch {}
      }
      return;
    }

    // ── Document reorder ───────────────────────────────────────────────────────
    if (over.data.current?.type === "doc-reorder" && activeData.type === "document" && activeData.docId) {
      const dropId = over.data.current.dropId as string;
      const isBefore = dropId.startsWith("doc-before:");
      const targetDocId = isBefore ? dropId.slice(11) : dropId.slice(10);
      if (activeData.docId === targetDocId) return;

      const dragDoc = documents.find((d) => d.id === activeData.docId);
      const targetDoc = documents.find((d) => d.id === targetDocId);
      if (!dragDoc || !targetDoc) return;

      const targetFolderId = targetDoc.folderId ?? null;
      const siblings = getSiblingDocuments(documents, targetFolderId, activeData.docId);
      const targetIdx = siblings.findIndex((d) => d.id === targetDocId);
      if (targetIdx === -1) return;
      const insertIdx = isBefore ? targetIdx : targetIdx + 1;
      const previousDocuments = documents;

      setDocuments(applyDocumentMove(documents, activeData.docId, targetFolderId, insertIdx));

      try {
        if ((dragDoc.folderId ?? null) !== targetFolderId) {
          const moveRes = await fetch(`/api/documents/${activeData.docId}/folder`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: targetFolderId }),
          });
          if (!(moveRes.ok || moveRes.status === 204)) throw new Error("move failed");
        }

        const reorderRes = await fetch(`/api/documents/${activeData.docId}/order`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIndex: insertIdx }),
        });
        if (!(reorderRes.ok || reorderRes.status === 204)) throw new Error("reorder failed");
      } catch {
        setDocuments(previousDocuments);
      }
      return;
    }

    // ── Folder reorder (main list) ─────────────────────────────────────────────
    if (over.data.current?.type === "folder-reorder" && activeData.type === "folder" && activeData.folderId) {
      const dropId = over.data.current.dropId as string;
      const isBefore = dropId.startsWith("folder-list-before:");
      const targetFolderId = isBefore ? dropId.slice(19) : dropId.slice(18);
      if (activeData.folderId === targetFolderId) return;

      const parentId = activeData.parentId ?? null;
      const siblings = getSiblingFolders(folders, parentId, activeData.folderId);
      const targetIdx = siblings.findIndex((f) => f.id === targetFolderId);
      if (targetIdx === -1) return;
      const insertIdx = isBefore ? targetIdx : targetIdx + 1;

      try {
        const res = await fetch(`/api/folders/${activeData.folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId, orderIndex: insertIdx }),
        });
        if (res.ok) onFolderMoved(activeData.folderId, parentId, insertIdx);
      } catch {}
      return;
    }

    const target = getFolderDropTarget(over.data.current);
    if (!target) return;

    if (activeData.type === "folder" && activeData.folderId) {
      let targetParentId: string | null;
      let targetIndex: number;

      if (target.kind === "root") {
        targetParentId = null;
        targetIndex = getSiblingFolders(folders, null, activeData.folderId).length;
      } else if (target.kind === "inside") {
        if (activeData.folderId === target.folderId) return;
        targetParentId = target.folderId;
        targetIndex = getSiblingFolders(folders, targetParentId, activeData.folderId).length;
      } else {
        targetParentId = target.parentId;
        const siblings = getSiblingFolders(folders, targetParentId, activeData.folderId);
        const anchorIndex = siblings.findIndex((f) => f.id === target.folderId);
        if (anchorIndex === -1) return;
        targetIndex = target.kind === "before" ? anchorIndex : anchorIndex + 1;
      }

      if (targetParentId !== null) {
        const descendants = new Set<string>();
        const queue = [activeData.folderId];
        while (queue.length) {
          const cur = queue.pop()!;
          descendants.add(cur);
          folders.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
        }
        if (descendants.has(targetParentId)) return;
      }

      try {
        const res = await fetch(`/api/folders/${activeData.folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: targetParentId, orderIndex: targetIndex }),
        });
        if (res.ok) onFolderMoved(activeData.folderId, targetParentId, targetIndex);
      } catch {}
    } else if (activeData.type === "document" && activeData.docId) {
      const targetFolderId = target.kind === "root" ? null : target.folderId;
      const targetIndex = getSiblingDocuments(documents, targetFolderId, activeData.docId).length;
      const previousDocuments = documents;
      setDocuments(applyDocumentMove(documents, activeData.docId, targetFolderId, targetIndex));
      try {
        const res = await fetch(`/api/documents/${activeData.docId}/folder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: targetFolderId }),
        });
        if (!(res.ok || res.status === 204)) {
          setDocuments(previousDocuments);
        }
      } catch {
        setDocuments(previousDocuments);
      }
    }
  }

  // DragOverlay ghost
  const activeFolderId = activeId?.startsWith("folder")
    ? (activeId.startsWith("folder-main:") ? activeId.slice(12) : activeId.slice(7))
    : null;
  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;
  const activeDocId = activeId?.startsWith("doc:")
    ? activeId.slice(4)
    : activeId?.startsWith("sidebar-doc:")
    ? activeId.slice(12)
    : null;
  const activeDoc = activeDocId ? documents.find((d) => d.id === activeDocId) : null;

  return (
    <DocumentsContext.Provider
      value={{
        folders,
        documents,
        loading,
        selectedFolderId,
        activeId,
        selectFolder: setSelectedFolderId,
        onFolderCreated,
        onFolderRenamed,
        onFolderDeleted,
        onDocumentCreated,
        onDocumentDeleted,
        onDocumentMoved,
      }}
    >
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
        <div className="flex h-full overflow-hidden" style={{ background: "var(--color-background)" }}>
          {folderSidebarCollapsed ? (
            /* Collapsed strip — click to expand */
            <div className="shrink-0 flex flex-col items-center pt-3 w-9 border-r-2 border-black" style={{ background: "var(--color-background)" }}>
              <button
                onClick={() => setFolderSidebarCollapsed(false)}
                title="Show folder sidebar"
                className="w-7 h-7 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                style={{ boxShadow: "var(--shadow-button)" }}
              >
                <ChevronRight size={12} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <>
              {/* Folder sidebar */}
              <div
                className="shrink-0 overflow-y-auto"
                style={{ width: `min(${sidebarWidth}px, 75vw)`, background: "var(--color-background)" }}
              >
                <FolderTree
                  folders={folders}
                  documents={documents}
                  selectedFolderId={selectedFolderId}
                  overDropTarget={overDropTarget}
                  activeId={activeId}
                  onSelectFolder={setSelectedFolderId}
                  onFolderCreated={onFolderCreated}
                  onFolderRenamed={onFolderRenamed}
                  onFolderDeleted={onFolderDeleted}
                  onDocumentCreated={onDocumentCreated}
                  onDocumentDeleted={onDocumentDeleted}
                  onCollapse={() => setFolderSidebarCollapsed(true)}
                />
              </div>

              {/* Resize handle — hidden on mobile */}
              <div
                className="hidden sm:block shrink-0 w-0.5 border-r-2 border-black cursor-col-resize hover:border-[var(--color-accent)] transition-colors"
                onMouseDown={onResizeStart}
              />
            </>
          )}

          {/* Page content */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {children}
          </div>
        </div>

        <DragOverlay>
          {activeFolder && (
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90">
              <FolderIcon size={12} />
              {activeFolder.name}
            </div>
          )}
          {activeDoc && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90 text-xs font-mono text-[var(--color-muted)]">
              <FileText size={11} className="shrink-0" />
              <span className="truncate max-w-32">{activeDoc.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </DocumentsContext.Provider>
  );
}
