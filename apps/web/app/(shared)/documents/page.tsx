"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useResizable } from "@/hooks/useResizable";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { DocumentList } from "@/components/shared/DocumentList";
import { DraggableDocument, DraggableFolder, Folder, FolderTree } from "@/components/shared/FolderTree";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showAllDocs, setShowAllDocs] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null | undefined>(undefined);

  const { width: sidebarWidth, onMouseDown: onResizeStart } = useResizable("sidebar-width", 200);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  // Load folders and documents on mount.
  useEffect(() => {
    Promise.all([
      fetch("/api/folders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/documents").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([foldersData, docsData]: [Folder[], DocumentSummary[]]) => {
        setFolders(foldersData);
        setDocuments(docsData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showForm) titleRef.current?.focus();
  }, [showForm]);

  const visibleDocs = showAllDocs
    ? documents
    : documents.filter((d) => (d.folderId ?? null) === selectedFolderId);

  const visibleSubfolders = showAllDocs
    ? folders.filter((f) => f.parentId === null)
    : folders.filter((f) => f.parentId === selectedFolderId);

  // Breadcrumb path from root to selectedFolderId.
  function buildBreadcrumb(folderId: string | null, visited = new Set<string>()): Folder[] {
    if (!folderId || visited.has(folderId)) return [];
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return [];
    visited.add(folderId);
    return [...buildBreadcrumb(folder.parentId, visited), folder];
  }
  const breadcrumb = buildBreadcrumb(selectedFolderId);

  function handleSelectFolder(id: string | null) {
    setSelectedFolderId(id);
    setShowAllDocs(id === null && selectedFolderId === null); // "All" when clicking root twice or staying at root
  }

  // Simpler: "All docs" when nothing selected, folder contents otherwise.
  function selectFolder(id: string | null) {
    setSelectedFolderId(id);
    setShowAllDocs(id === null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          folderId: showAllDocs ? null : selectedFolderId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const created = await res.json() as DocumentSummary;
      setDocuments((prev) => [created, ...prev]);
      setTitle("");
      setContent("");
      setShowForm(false);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  const handleFolderCreated = useCallback((folder: Folder) => {
    setFolders((prev) => [...prev, folder]);
  }, []);

  const handleFolderRenamed = useCallback((folder: Folder) => {
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
  }, []);

  const handleFolderDeleted = useCallback((id: string) => {
    // Collect all descendant folder IDs so we can also remove their documents.
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
    if (selectedFolderId === id) selectFolder(null);
  }, [selectedFolderId]);

  const handleDocumentDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleDocumentMoved = useCallback((docId: string, folderId: string | null) => {
    setDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, folderId } : d));
  }, []);

  const handleFolderMoved = useCallback((folderId: string, newParentId: string | null) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, parentId: newParentId } : f))
    );
  }, []);

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverFolderId(undefined);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { type: string; docId?: string; folderId?: string };
    const overData = over.data.current as { folderId?: string | null };
    const targetFolderId = overData?.folderId !== undefined ? overData.folderId : null;

    if (activeData.type === "folder" && activeData.folderId) {
      if (activeData.folderId === targetFolderId) return;
      // Prevent moving a folder into one of its own descendants (cycle).
      if (targetFolderId !== null) {
        const descendants = new Set<string>();
        const queue = [activeData.folderId];
        while (queue.length) {
          const cur = queue.pop()!;
          descendants.add(cur);
          folders.filter((f) => f.parentId === cur).forEach((f) => queue.push(f.id));
        }
        if (descendants.has(targetFolderId)) return;
      }
      try {
        const res = await fetch(`/api/folders/${activeData.folderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: targetFolderId }),
        });
        if (res.ok) {
          handleFolderMoved(activeData.folderId, targetFolderId);
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
          handleDocumentMoved(activeData.docId, targetFolderId);
        }
      } catch {}
    }
  }

  const inputClass =
    "w-full text-sm border-2 border-black px-3 py-2 focus:outline-none focus:border-[var(--color-accent)] bg-white text-black font-mono placeholder:text-[var(--color-muted)]";

  return (
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
        {/* Sidebar folder tree */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{ width: `${sidebarWidth}px`, background: "var(--color-background)" }}
        >
          <FolderTree
            folders={folders}
            documents={documents}
            selectedFolderId={showAllDocs ? null : selectedFolderId}
            overFolderId={overFolderId}
            onSelectFolder={selectFolder}
            onFolderCreated={handleFolderCreated}
            onFolderRenamed={handleFolderRenamed}
            onFolderDeleted={handleFolderDeleted}
            onDocumentDeleted={handleDocumentDeleted}
            onDocumentMoved={handleDocumentMoved}
            onFolderMoved={handleFolderMoved}
          />
        </div>

        {/* Resize handle */}
        <div
          className="shrink-0 w-0.5 border-r-2 border-black cursor-col-resize hover:border-[var(--color-accent)] transition-colors"
          onMouseDown={onResizeStart}
        />

        {/* Main content area */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="border-b-2 border-black bg-[var(--color-background)]">
            <div className="px-6 py-4 flex items-center justify-between">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs font-mono font-bold uppercase tracking-wider text-black">
                <button
                  onClick={() => selectFolder(null)}
                  className="hover:text-[var(--color-accent)] transition-colors"
                >
                  Documents
                </button>
                {breadcrumb.map((f) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <span className="text-[var(--color-muted)]">/</span>
                    <button
                      onClick={() => selectFolder(f.id)}
                      className="hover:text-[var(--color-accent)] transition-colors"
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-muted)] font-mono">
                  {!loading && `${visibleDocs.length} doc${visibleDocs.length !== 1 ? "s" : ""}`}
                </span>
                <button
                  onClick={() => { setShowForm((v) => !v); setError(null); }}
                  className="text-xs px-3 py-1.5 border-2 border-black font-bold uppercase tracking-wider font-mono transition-all hover:bg-[var(--color-muted-bg)]"
                  style={{ borderRadius: "var(--border-radius)", background: showForm ? "var(--color-muted-bg)" : "var(--color-surface)", boxShadow: "var(--shadow-button)" }}
                >
                  {showForm ? "Cancel" : "Import"}
                </button>
                <Link
                  href="/documents/new"
                  className="text-xs px-3 py-1.5 border-2 border-black font-bold uppercase tracking-wider font-mono bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
                >
                  New
                </Link>
              </div>
            </div>
          </div>

          {showForm && (
            <div className="max-w-3xl mx-auto mt-4 px-4">
              <form
                onSubmit={handleSubmit}
                className="bg-[var(--color-surface)] border-2 border-black p-5 space-y-3"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
              >
                <input
                  ref={titleRef}
                  type="text"
                  placeholder="Document title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                  required
                />
                <textarea
                  placeholder="Paste Markdown content here…"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  className={`${inputClass} resize-y`}
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                  required
                />
                {error && <p className="text-xs text-[var(--color-danger)] font-mono font-bold">{error}</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting || !title.trim() || !content.trim()}
                    className="text-xs px-4 py-2 border-2 border-black bg-[var(--color-accent)] text-white font-bold uppercase tracking-wider font-mono disabled:opacity-50"
                    style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
                  >
                    {submitting ? "Saving…" : "Save document"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div
            className="bg-[var(--color-surface)] mt-4 mx-4 border-2 border-black"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <DocumentList
              documents={visibleDocs}
              loading={loading}
              folders={folders}
              subfolders={visibleSubfolders}
              onSelectFolder={selectFolder}
              onMoveToFolder={async (docId, folderId) => {
                try {
                  const res = await fetch(`/api/documents/${docId}/folder`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folderId }),
                  });
                  if (res.ok || res.status === 204) handleDocumentMoved(docId, folderId);
                } catch {}
              }}
              renderWrapper={(doc, node) => (
                <DraggableDocument key={doc.id} docId={doc.id}>
                  {node}
                </DraggableDocument>
              )}
              renderFolderWrapper={(folder, node) => (
                <DraggableFolder key={folder.id} folderId={folder.id} parentId={folder.parentId}>
                  {node}
                </DraggableFolder>
              )}
            />
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeId?.startsWith("folder") && (() => {
          const folderId = activeId.startsWith("folder-main:")
            ? activeId.slice(12)
            : activeId.slice(7);
          const name = folders.find((f) => f.id === folderId)?.name;
          return name ? (
            <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {name}
            </div>
          ) : null;
        })()}
        {activeId?.startsWith("doc:") && (() => {
          const doc = documents.find((d) => d.id === activeId.slice(4));
          return doc ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-[var(--color-accent)] shadow-lg opacity-90 text-xs font-mono text-[var(--color-muted)]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="truncate max-w-32">{doc.title}</span>
            </div>
          ) : null;
        })()}
      </DragOverlay>
    </DndContext>
  );
}
