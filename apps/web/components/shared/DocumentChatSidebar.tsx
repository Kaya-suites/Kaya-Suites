"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatSession, CitationRef, DocumentContext, KayaDocument } from "@/types/chat";
import { ChatPanel } from "./ChatPanel";

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
    <aside className="flex h-[42vh] min-h-[320px] w-full flex-col border-t-2 border-black bg-[var(--color-surface)] lg:h-full lg:min-h-0 lg:w-[420px] lg:border-l-2 lg:border-t-0">
      <div className="border-b-2 border-black bg-[var(--color-background)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-muted)] font-mono">
              AI Sidepanel
            </p>
            <h2 className="mt-1 truncate text-sm font-bold uppercase tracking-wide text-black font-mono">
              Chat While Editing
            </h2>
          </div>
          <button
            onClick={handleNewSession}
            className="shrink-0 border-2 border-black bg-[var(--color-accent)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            New Chat
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-black font-mono">
          Working in <span className="font-bold">{document.title}</span>. Ask Kaya to rewrite sections, answer questions, or propose document edits without leaving this page.
        </p>

        <p className="mt-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)] font-mono break-all">
          Document ID: <span className="font-bold text-black">{document.id}</span>
        </p>

        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)] font-mono">
            Conversation
          </label>
          <select
            value={sessions.some((s) => s.id === sessionId) ? sessionId : ""}
            onChange={(e) => setSessionId(e.target.value || crypto.randomUUID())}
            disabled={loadingSessions}
            className="w-full border-2 border-black bg-white px-3 py-2 text-xs font-mono text-black outline-none"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
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
