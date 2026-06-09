"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DocumentList } from "@/components/shared/DocumentList";
import { DraggableDocument, DraggableFolder, type Folder } from "@/components/shared/FolderTree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg)]">
      {/* Header — sticky, hairline bottom, lines up with the sidebar border */}
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-[var(--font-size-base)] text-[var(--color-text-muted)] min-w-0"
          >
            <button
              onClick={() => selectFolder(null)}
              className="font-[var(--font-serif)] text-2xl font-semibold tracking-tight text-[var(--color-text)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              Documents
            </button>
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex items-center gap-1.5 min-w-0">
                <span className="text-[var(--color-text-subtle)]" aria-hidden="true">
                  /
                </span>
                <button
                  onClick={() => selectFolder(f.id)}
                  className="font-[var(--font-serif)] text-2xl font-semibold tracking-tight text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors truncate"
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[var(--font-size-sm)] text-[var(--color-text-subtle)] hidden sm:inline">
              {!loading && `${visibleDocs.length} doc${visibleDocs.length !== 1 ? "s" : ""}`}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setShowForm((v) => !v); setError(null); }}
              aria-pressed={showForm}
            >
              {showForm ? "Cancel" : "Import"}
            </Button>
            <Link href="/documents/new">
              <Button size="sm">New</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Import form — flush card, no inner shadow doubling */}
      {showForm && (
        <div className="max-w-3xl mx-auto mt-6 px-6">
          <form
            onSubmit={handleSubmit}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4"
          >
            <Input
              ref={titleRef}
              type="text"
              placeholder="Document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <textarea
              placeholder="Paste Markdown content here…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              required
              className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--font-size-base)] text-[var(--color-text)] leading-relaxed resize-y placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            />
            {error && (
              <p className="text-[var(--font-size-sm)] text-[var(--color-danger)]" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={submitting || !title.trim() || !content.trim()}
              >
                {submitting ? "Saving…" : "Save document"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Document list — no outer card, list bleeds to the layout edges so dividers do the work */}
      <section className="max-w-5xl mx-auto px-2 sm:px-0 py-2">
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
      </section>
    </div>
  );
}
