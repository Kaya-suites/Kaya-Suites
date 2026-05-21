"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { DocumentEditor } from "@/components/shared/DocumentEditor";
import type { KayaDocument } from "@/types/chat";

export default function DocumentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [doc, setDoc] = useState<KayaDocument | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: KayaDocument) => setDoc(data))
      .catch(() => setError(true));
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 font-mono" style={{ background: "var(--color-background)" }}>
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)]">Document not found.</p>
        <Link
          href="/documents"
          className="text-xs font-bold uppercase tracking-wider border-2 border-black px-3 py-1.5 hover:bg-[var(--color-muted-bg)] transition-all"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          ← Back to Documents
        </Link>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex flex-col h-screen" style={{ background: "var(--color-surface)" }}>
        <div className="flex items-center gap-3 px-6 py-3 border-b-2 border-black" style={{ background: "var(--color-background)" }}>
          <div className="h-4 w-24 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ borderRadius: "var(--border-radius)" }} />
          <div className="flex-1 h-5 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ borderRadius: "var(--border-radius)" }} />
          <div className="h-8 w-16 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ borderRadius: "var(--border-radius)" }} />
        </div>
        <div className="flex-1 px-6 py-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 border-2 border-black bg-[var(--color-muted-bg)] animate-pulse" style={{ width: `${70 + (i % 3) * 10}%`, borderRadius: "var(--border-radius)" }} />
          ))}
        </div>
      </div>
    );
  }

  return <DocumentEditor doc={doc} />;
}
