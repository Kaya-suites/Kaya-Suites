"use client";

import { useState, useCallback, useEffect } from "react";
import type { ChatSession, CitationRef } from "@/types/chat";
import { SessionRail } from "./SessionRail";
import { ChatPanel } from "./ChatPanel";
import { DocumentPanel } from "./DocumentPanel";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { useOnboarding } from "@/hooks/useOnboarding";
import { Plus } from "lucide-react";

async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch("/api/sessions");
    return (await res.json()) as ChatSession[];
  } catch {
    return [];
  }
}


export function ChatLayout() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [scrollToParagraphId, setScrollToParagraphId] = useState<string | null>(null);
  const [docRefreshKey, setDocRefreshKey] = useState(0);
  const onboarding = useOnboarding();

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!onboarding.isLoaded || onboarding.state?.completed.add_document) return;
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : []))
      .then((docs: unknown[]) => { if (docs.length > 0) onboarding.markStepComplete("add_document"); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding.isLoaded]);

  function handleCitationClick(ref: CitationRef) {
    setOpenDocId(ref.docId);
    setScrollToParagraphId(ref.paragraphId);
  }

  function handleDocumentUpdated(docId: string) {
    setOpenDocId(docId);
    setScrollToParagraphId(null);
    setDocRefreshKey((k) => k + 1);
  }

  function handleNewSession() {
    setSessionId(crypto.randomUUID());
    setOpenDocId(null);
  }

  const handleSessionCreated = useCallback((session: ChatSession) => {
    setSessions((prev) => [session, ...prev]);
    setSessionId(session.id);
  }, []);

  const handleSessionSelect = useCallback((id: string) => {
    setSessionId(id);
    setOpenDocId(null);
  }, []);

  const handleSessionRenamed = useCallback((id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    handleSessionRenamed(id, title);
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, [handleSessionRenamed]);

  const handleDeleteSession = useCallback(async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setSessionId(remaining.length > 0 ? remaining[0].id : crypto.randomUUID());
    }
    await fetch(`/api/sessions/${id}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId, sessions]);

  const handlePinSession = useCallback(async (id: string, pinned: boolean) => {
    setSessions((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, pinned } : s))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        })
    );
    await fetch(`/api/sessions/${id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).catch(() => {});
  }, []);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--color-background)" }}>
      <div className="hidden md:flex shrink-0">
        <SessionRail
          sessions={sessions}
          currentSessionId={sessionId}
          onSelect={handleSessionSelect}
          onNew={handleNewSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          onPin={handlePinSession}
        />
      </div>

      <div
        className={`flex flex-col min-w-0 border-r-2 border-black bg-[var(--color-surface)] transition-all duration-200 ${
          openDocId ? "w-1/2" : "flex-1"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-black shrink-0 bg-[var(--color-background)]">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 border-2 border-black bg-black flex items-center justify-center text-white text-xs font-bold font-mono"
              style={{ borderRadius: "var(--border-radius)" }}
            >
              K
            </div>
            <span className="text-xs font-bold text-black uppercase tracking-wider font-mono">Kaya</span>
          </div>
          <button
            onClick={handleNewSession}
            className="md:hidden p-1.5 border-2 border-transparent hover:border-black hover:bg-[var(--color-muted-bg)] text-black transition-all"
            style={{ borderRadius: "var(--border-radius)" }}
            title="New conversation"
          >
            <Plus size={15} strokeWidth={1.5} />
          </button>
        </div>

        <ChatPanel
          key={sessionId}
          sessionId={sessionId}
          isPersisted={sessions.some((s) => s.id === sessionId)}
          onCitationClick={handleCitationClick}
          onDocumentUpdated={handleDocumentUpdated}
          onStepComplete={onboarding.markStepComplete}
          onSessionRenamed={handleSessionRenamed}
          onSessionCreated={handleSessionCreated}
        />
      </div>

      {openDocId && (
        <div className="flex flex-col flex-1 min-w-0 bg-[var(--color-surface)]">
          <DocumentPanel
            docId={openDocId}
            scrollToParagraphId={scrollToParagraphId}
            refreshKey={docRefreshKey}
            onClose={() => setOpenDocId(null)}
          />
        </div>
      )}

      <OnboardingChecklist
        isLoaded={onboarding.isLoaded}
        dismissed={onboarding.state?.dismissed ?? false}
        steps={onboarding.steps}
        demoSeeded={onboarding.state?.demoSeeded ?? false}
        onDismiss={onboarding.dismiss}
        onSeedDemo={onboarding.seedDemo}
        onMarkComplete={onboarding.markStepComplete}
      />
    </div>
  );
}
