"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatSession, CitationRef, DocumentContext, KayaDocument } from "@/types/chat";
import { ChatPanel } from "./ChatPanel";
import { Button } from "@/components/ui/button";

type Props = {
  document: KayaDocument;
  onDocumentUpdated: (docId: string) => void | Promise<void>;
};

async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch("/api/sessions");
    return (await res.json()) as ChatSession[];
  } catch {
    return [];
  }
}

export function DocumentChatSidebar({ document, onDocumentUpdated }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [loadingSessions, setLoadingSessions] = useState(true);
  const requestContext = useMemo<DocumentContext>(
    () => ({
      docId: document.id,
      title: document.title,
      tags: document.tags,
      body: document.body,
    }),
    [document.body, document.id, document.tags, document.title],
  );

  useEffect(() => {
    let cancelled = false;

    fetchSessions().then((existing) => {
      if (cancelled) return;
      setSessions(existing);
      setLoadingSessions(false);
    }).catch(() => {
      if (!cancelled) setLoadingSessions(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleNewSession = useCallback(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  const handleSessionCreated = useCallback((session: ChatSession) => {
    setSessions((prev) => [session, ...prev]);
    setSessionId(session.id);
  }, []);

  const handleSessionRenamed = useCallback((renamedId: string, title: string) => {
    setSessions((prev) => prev.map((session) => (
      session.id === renamedId ? { ...session, title } : session
    )));
  }, []);

  const handleCitationClick = useCallback((ref: CitationRef) => {
    if (ref.docId === document.id) return;
    window.open(`/documents/${ref.docId}`, "_blank", "noopener,noreferrer");
  }, [document.id]);

  return (
    <aside className="flex h-[42vh] min-h-[320px] w-full flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:h-full lg:min-h-0 lg:w-[420px] lg:border-l lg:border-t-0">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[var(--font-size-xs)] tracking-wide text-[var(--color-text-subtle)]">
              AI sidepanel
            </p>
            <h2 className="mt-0.5 truncate font-[var(--font-serif)] text-[var(--font-size-lg)] font-semibold text-[var(--color-text)] tracking-tight">
              Chat while editing
            </h2>
          </div>
          <Button size="sm" onClick={handleNewSession}>
            New chat
          </Button>
        </div>

        <p className="mt-4 text-[var(--font-size-sm)] leading-relaxed text-[var(--color-text-muted)]">
          Working in <span className="font-medium text-[var(--color-text)]">{document.title}</span>. Ask Kaya to rewrite sections, answer questions, or propose document edits without leaving this page.
        </p>

        <div className="mt-4">
          <label
            htmlFor="doc-sidebar-conversation"
            className="mb-1.5 block text-[var(--font-size-xs)] font-medium text-[var(--color-text-muted)]"
          >
            Conversation
          </label>
          <select
            id="doc-sidebar-conversation"
            value={sessions.some((s) => s.id === sessionId) ? sessionId : ""}
            onChange={(e) => setSessionId(e.target.value || crypto.randomUUID())}
            disabled={loadingSessions}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            <option value="">New conversation</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ChatPanel
          key={sessionId}
          sessionId={sessionId}
          isPersisted={sessions.some((s) => s.id === sessionId)}
          onCitationClick={handleCitationClick}
          onDocumentUpdated={onDocumentUpdated}
          onSessionRenamed={handleSessionRenamed}
          onSessionCreated={handleSessionCreated}
          requestContext={requestContext}
        />
      </div>
    </aside>
  );
}
