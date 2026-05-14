"use client";

import { useEffect, useState } from "react";
import { DocumentList } from "@/components/shared/DocumentList";

type DocumentSummary = {
  id: string;
  title: string;
  tags: string[];
  lastReviewed?: string;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/documents")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DocumentSummary[]) => setDocuments(data))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-stone-900">Documents</h1>
          </div>
          <span className="text-xs text-stone-400">
            {!loading && `${documents.length} document${documents.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* List */}
      <div className="max-w-3xl mx-auto py-4 bg-white rounded-lg mt-4 mx-4 shadow-sm border border-stone-200">
        <DocumentList documents={documents} loading={loading} />
      </div>
    </div>
  );
}
