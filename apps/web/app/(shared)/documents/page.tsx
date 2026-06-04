"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DocumentList } from "@/components/shared/DocumentList";
import { DraggableDocument, DraggableFolder, type Folder } from "@/components/shared/FolderTree";
import { useDocumentsContext } from "./context";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
  sortOrder?: number;
};

export default function DocumentsPage() {
  const {
    folders,
    documents,
    loading,
    selectedFolderId,
    activeId,
    selectFolder,
    onDocumentCreated,
    onDocumentMoved,
  } = useDocumentsContext();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showForm) titleRef.current?.focus();
  }, [showForm]);

  const visibleDocs = documents
    .filter((d) => (d.folderId ?? null) === selectedFolderId)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const visibleSubfolders = selectedFolderId === null
    ? folders.filter((f) => f.parentId === null)
    : folders.filter((f) => f.parentId === selectedFolderId);

  function buildBreadcrumb(folderId: string | null, visited = new Set<string>()): Folder[] {
    if (!folderId || visited.has(folderId)) return [];
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return [];
    visited.add(folderId);
    return [...buildBreadcrumb(folder.parentId, visited), folder];
  }
  const breadcrumb = buildBreadcrumb(selectedFolderId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), folderId: selectedFolderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const created = await res.json() as DocumentSummary;
      onDocumentCreated(created);
      setTitle("");
      setContent("");
      setShowForm(false);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full text-sm border-2 border-black px-3 py-2 focus:outline-none focus:border-[var(--color-accent)] bg-white text-black font-mono placeholder:text-[var(--color-muted)]";

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b-2 border-black bg-[var(--color-background)]">
        <div className="px-6 py-4 flex items-center justify-between">
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

      {/* Import form */}
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

      {/* Document list */}
      <div
        className="bg-[var(--color-surface)] mt-4 mx-4 border-2 border-black"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <DocumentList
          documents={visibleDocs}
          loading={loading}
          folders={folders}
          subfolders={visibleSubfolders}
          activeId={activeId}
          onSelectFolder={selectFolder}
          onMoveToFolder={async (docId, folderId) => {
            try {
              const res = await fetch(`/api/documents/${docId}/folder`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folderId }),
              });
              if (res.ok || res.status === 204) onDocumentMoved(docId, folderId);
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
  );
}
