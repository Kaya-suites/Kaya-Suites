"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { KayaDocument } from "@/types/chat";
import { DocumentChatSidebar } from "./DocumentChatSidebar";
import { ChevronLeft, MessageSquare, Copy, Check, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { apiFetch } from "@/lib/api";

const KayaMarkdownEditor = dynamic(
  () => import("@kaya/markdown-editor").then((m) => m.KayaMarkdownEditor),
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
  const [chatOpen, setChatOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingRemoteDoc, setPendingRemoteDoc] = useState<KayaDocument | null>(null);
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

  const isDirty =
    title !== serverDoc.title || body !== serverDoc.body || tagsInput !== serverDoc.tags.join(", ");

  const applySnapshot = useCallback((nextDoc: KayaDocument) => {
    serverDocRef.current = nextDoc;
    setServerDoc(nextDoc);
    setTitle(nextDoc.title);
    setBody(nextDoc.body);
    setTagsInput(nextDoc.tags.join(", "));
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
        const res = await apiFetch(`/documents/${baseline.id}`, {
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
    const res = await apiFetch(`/documents/${serverDoc.id}`);
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
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  async function handleCopyMarkdown() {
    await navigator.clipboard.writeText(body);
    setCopyStatus("copied");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 2000);
  }

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
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

  function handleClearAll() {
    if (!window.confirm("Clear all content? This cannot be undone.")) return;
    if (status === "saved") setStatus("idle");
    setBody("");
  }

  return (
    <div className="flex h-full min-h-0 bg-[var(--color-surface)]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <Link
            href="/documents"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] text-[var(--font-size-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <ChevronLeft size={14} />
            Docs
          </Link>

          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              aria-label="Document title"
              className="w-full font-[var(--font-serif)] text-[var(--font-size-lg)] font-semibold tracking-tight text-[var(--color-text)] bg-transparent border-none outline-none placeholder:text-[var(--color-text-subtle)]"
              placeholder="Untitled"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              className={cn(chatOpen && "bg-[var(--color-bg-subtle)]")}
            >
              <MessageSquare size={13} />
              {chatOpen ? "Hide chat" : "Show chat"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleCopyMarkdown()}
              aria-label="Copy document as Markdown"
            >
              {copyStatus === "copied" ? (
                <>
                  <Check size={12} strokeWidth={1.8} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={13} />
                  Copy MD
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClearAll}>
              Clear
            </Button>
            {status === "saved" && (
              <span className="text-[var(--font-size-sm)] text-[var(--color-success)] inline-flex items-center gap-1">
                <Check size={12} strokeWidth={1.8} />
                Saved
              </span>
            )}
            {status === "error" && (
              <span className="text-[var(--font-size-sm)] text-[var(--color-danger)]">
                Save failed
              </span>
            )}
            <Button
              size="sm"
              onClick={handleSaveClick}
              disabled={!isDirty || status === "saving" || pendingRemoteDoc !== null}
            >
              {status === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <Tag size={12} className="text-[var(--color-text-subtle)] shrink-0" />
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => handleTagsChange(e.target.value)}
            placeholder="Add tags, comma-separated…"
            aria-label="Tags"
            className="flex-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)] bg-transparent border-none outline-none placeholder:text-[var(--color-text-subtle)]"
          />
        </div>

        {pendingRemoteDoc && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <p className="text-[var(--font-size-sm)] text-[var(--color-text)]">
              Agent changes were applied on the server. Reload before saving to
              avoid overwriting them.
            </p>
            <Button size="sm" variant="secondary" onClick={handleReloadRemoteVersion}>
              Reload latest
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          <KayaMarkdownEditor markdown={body} onChange={handleBodyChange} />
        </div>
      </div>

      {chatOpen && (
        <DocumentChatSidebar
          document={serverDoc}
          onDocumentUpdated={handleDocumentUpdated}
        />
      )}
    </div>
  );
}
