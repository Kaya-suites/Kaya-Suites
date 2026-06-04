"use client";

import { createContext, useContext } from "react";
import type { Folder, DocumentSummary } from "@/components/shared/FolderTree";

export type DocumentsContextValue = {
  folders: Folder[];
  documents: DocumentSummary[];
  loading: boolean;
  selectedFolderId: string | null;
  activeId: string | null;
  selectFolder: (id: string | null) => void;
  onFolderCreated: (folder: Folder) => void;
  onFolderRenamed: (folder: Folder) => void;
  onFolderDeleted: (id: string) => void;
  onDocumentCreated: (doc: DocumentSummary) => void;
  onDocumentDeleted: (id: string) => void;
  onDocumentMoved: (docId: string, folderId: string | null, orderIndex?: number) => void;
};

export const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function useDocumentsContext(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error("useDocumentsContext must be used within DocumentsLayout");
  return ctx;
}
