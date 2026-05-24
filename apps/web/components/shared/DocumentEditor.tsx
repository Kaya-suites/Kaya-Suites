"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { KayaDocument } from "@/types/chat";
import { DocumentChatSidebar } from "./DocumentChatSidebar";
import { useResizable } from "@/hooks/useResizable";
import { FolderTree, type Folder, type DocumentSummary } from "./FolderTree";

const KayaMarkdownEditor = dynamic(
  () => import("./KayaMarkdownEditor").then((m) => m.KayaMarkdownEditor),
  { ssr: false },
);

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  doc: KayaDocument;
};

export function DocumentEditor({ doc }: Props) {
  const [serverDoc, setServerDoc] = useState(doc);
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [tagsInput, setTagsInput] = useState(doc.tags.join(", "));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [pendingRemoteDoc, setPendingRemoteDoc] = useState<KayaDocument | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(doc.folderId ?? null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const serverDocRef = useRef(doc);
  const pendingRemoteDocRef = useRef<KayaDocument | null>(null);
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const draftRef = useRef({
    title: doc.title,
    body: doc.body,
    tagsInput: doc.tags.join(", "),
  });
  const { width: sidebarWidth, onMouseDown: onResizeStart } = useResizable("document-detail-sidebar-width", 220);

  const isDirty =
    title !== serverDoc.title || body !== serverDoc.body || tagsInput !== serverDoc.tags.join(", ");

  const applySnapshot = useCallback((nextDoc: KayaDocument) => {
    serverDocRef.current = nextDoc;
    setServerDoc(nextDoc);
    setTitle(nextDoc.title);
    setBody(nextDoc.body);
    setTagsInput(nextDoc.tags.join(", "));
    setSelectedFolderId(nextDoc.folderId ?? null);
    setPendingRemoteDoc(null);
  }, []);

  useEffect(() => {
    handleSaveRef.current = async () => {
      const currentDraft = draftRef.current;
      const currentTags = currentDraft.tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const baseline = serverDocRef.current;
      const isDraftDirty =
        currentDraft.title !== baseline.title ||
        currentDraft.body !== baseline.body ||
        currentDraft.tagsInput !== baseline.tags.join(", ");

      if (!isDraftDirty || pendingRemoteDocRef.current) return;

      if (isSavingRef.current) {
        saveQueuedRef.current = true;
        return;
      }

      isSavingRef.current = true;
      setStatus("saving");
      try {
        const res = await fetch(`/api/documents/${baseline.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: currentDraft.title,
            body: currentDraft.body,
            tags: currentTags,
          }),
        });
        if (!res.ok) {
          setStatus("error");
        } else {
          const nextServerDoc = {
            ...serverDocRef.current,
            title: currentDraft.title,
            body: currentDraft.body,
            tags: currentTags,
          };
          serverDocRef.current = nextServerDoc;
          setServerDoc(nextServerDoc);

          const latestDraft = draftRef.current;
          const hasNewerChanges =
            latestDraft.title !== currentDraft.title ||
            latestDraft.body !== currentDraft.body ||
            latestDraft.tagsInput !== currentDraft.tagsInput;

          if (hasNewerChanges) {
            saveQueuedRef.current = true;
            setStatus("idle");
          } else {
            setStatus("saved");
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setStatus("idle"), 2500);
          }
        }
      } catch {
        setStatus("error");
      } finally {
        isSavingRef.current = false;

        if (saveQueuedRef.current) {
          saveQueuedRef.current = false;
          const latestDraft = draftRef.current;
          const latestBaseline = serverDocRef.current;
          const shouldSaveAgain =
            !pendingRemoteDocRef.current &&
            (latestDraft.title !== latestBaseline.title ||
              latestDraft.body !== latestBaseline.body ||
              latestDraft.tagsInput !== latestBaseline.tags.join(", "));

          if (shouldSaveAgain) {
            void handleSaveRef.current();
          }
        }
      }
    };
  }, []);

  const refreshFromServer = useCallback(async () => {
    const res = await fetch(`/api/documents/${serverDoc.id}`);
    if (!res.ok) throw new Error("refresh failed");
    return await res.json() as KayaDocument;
  }, [serverDoc.id]);

  const handleDocumentUpdated = useCallback(async (updatedDocId: string) => {
    if (updatedDocId !== serverDoc.id) return;
    try {
      const latest = await refreshFromServer();
      if (isDirty) {
        setPendingRemoteDoc(latest);
        return;
      }
      applySnapshot(latest);
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
    }
  }, [applySnapshot, isDirty, refreshFromServer, serverDoc.id]);

  async function handleReloadRemoteVersion() {
    if (!pendingRemoteDoc) return;
    applySnapshot(pendingRemoteDoc);
    setStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  useEffect(() => {
    serverDocRef.current = serverDoc;
  }, [serverDoc]);

  useEffect(() => {
    pendingRemoteDocRef.current = pendingRemoteDoc;
  }, [pendingRemoteDoc]);

  useEffect(() => {
    draftRef.current = { title, body, tagsInput };
  }, [title, body, tagsInput]);

  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (!isDirty || pendingRemoteDoc) return;

    autosaveTimer.current = setTimeout(() => {
      void handleSaveRef.current();
    }, 1000);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [body, isDirty, pendingRemoteDoc, tagsInput, title]);

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/folders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/documents").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([foldersData, docsData]: [Folder[], DocumentSummary[]]) => {
        setFolders(foldersData);
        setDocuments(docsData);
      })
      .catch(() => {});
  }, [doc.id]);

  const handleFolderCreated = useCallback((folder: Folder) => {
    setFolders((prev) => [...prev, folder]);
  }, []);

  const handleFolderRenamed = useCallback((folder: Folder) => {
    setFolders((prev) => prev.map((item) => (item.id === folder.id ? folder : item)));
  }, []);

  const handleFolderDeleted = useCallback((id: string) => {
    setFolders((prev) => {
      const toDelete = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const current = queue.pop()!;
        toDelete.add(current);
        prev.filter((folder) => folder.parentId === current).forEach((folder) => queue.push(folder.id));
      }
      setDocuments((docs) => docs.filter((item) => !item.folderId || !toDelete.has(item.folderId)));
      return prev.filter((folder) => !toDelete.has(folder.id));
    });
    if (selectedFolderId === id) setSelectedFolderId(null);
  }, [selectedFolderId]);

  const handleDocumentCreated = useCallback((newDoc: DocumentSummary) => {
    setDocuments((prev) => [newDoc, ...prev.filter((item) => item.id !== newDoc.id)]);
  }, []);

  const handleDocumentDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  function handleTitleChange(value: string) {
    if (status === "saved") setStatus("idle");
    setTitle(value);
  }

  function handleBodyChange(value: string) {
    if (status === "saved") setStatus("idle");
    setBody(value);
  }

  function handleTagsChange(value: string) {
    if (status === "saved") setStatus("idle");
    setTagsInput(value);
  }

  function handleSaveClick() {
    void handleSaveRef.current();
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--color-surface)]">
      <div
        className="shrink-0 overflow-y-auto border-r-2 border-black bg-[var(--color-background)]"
        style={{ width: `${sidebarWidth}px` }}
      >
        <FolderTree
          folders={folders}
          documents={documents}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onFolderCreated={handleFolderCreated}
          onFolderRenamed={handleFolderRenamed}
          onFolderDeleted={handleFolderDeleted}
          onDocumentCreated={handleDocumentCreated}
          onDocumentDeleted={handleDocumentDeleted}
        />
      </div>

      <div
        className="shrink-0 w-0.5 border-r-2 border-black cursor-col-resize hover:border-[var(--color-accent)] transition-colors"
        onMouseDown={onResizeStart}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b-2 border-black bg-[var(--color-background)] shrink-0">
          <Link
            href="/documents"
            className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--color-muted)] hover:text-black transition-colors font-mono border-2 border-transparent hover:border-black px-2 py-1"
            style={{ borderRadius: "var(--border-radius)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Docs
          </Link>

          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full text-sm font-bold text-black bg-transparent border-none outline-none placeholder-[var(--color-muted)] font-mono uppercase tracking-wide"
              placeholder="UNTITLED"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {status === "saved" && (
              <span className="text-xs text-[var(--color-success)] flex items-center gap-1 font-mono font-bold uppercase">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Saved
              </span>
            )}
            {status === "error" && (
              <span className="text-xs text-[var(--color-danger)] font-mono font-bold uppercase">Save failed</span>
            )}
            <button
              onClick={handleSaveClick}
              disabled={!isDirty || status === "saving" || pendingRemoteDoc !== null}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 py-2 border-b-2 border-black bg-[var(--color-background)] shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-muted)] shrink-0">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => handleTagsChange(e.target.value)}
            placeholder="Add tags, comma-separated…"
            className="flex-1 text-xs text-[var(--color-muted)] bg-transparent border-none outline-none placeholder-[var(--color-muted)] font-mono"
          />
        </div>

        {pendingRemoteDoc && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-b-2 border-black bg-[var(--color-warning-bg)]">
            <p className="text-xs font-mono font-bold uppercase tracking-wider text-black">
              Agent changes were applied on the server. Reload before saving to avoid overwriting them.
            </p>
            <button
              onClick={handleReloadRemoteVersion}
              className="shrink-0 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border-2 border-black bg-white text-black font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Reload latest
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          <KayaMarkdownEditor markdown={body} onChange={handleBodyChange} />
        </div>
      </div>

      <DocumentChatSidebar
        document={serverDoc}
        onDocumentUpdated={handleDocumentUpdated}
      />
    </div>
  );
}
