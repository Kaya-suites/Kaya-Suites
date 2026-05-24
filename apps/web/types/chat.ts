export type Role = "user" | "assistant";

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CitationRef = {
  label: number;
  docId: string;
  paragraphId: string;
  title: string;
};

export type ProposedEdit = {
  id: string;
  docId: string;
  paragraphId: string;
  original: string;
  proposed: string;
  status: "pending" | "approved" | "rejected";
};

export type ProposedDelete = {
  id: string;
  docId: string;
  docTitle: string;
  status: "pending" | "approved" | "rejected";
};

export type ProposedFolderCreate = {
  id: string;
  name: string;
  parentId: string | null;
  status: "pending" | "approved" | "rejected";
};

export type ChatMessageData = {
  id: string;
  role: Role;
  content: string;
  citations: CitationRef[];
  proposedEdits?: ProposedEdit[];
  proposedDeletes?: ProposedDelete[];
  proposedFolderCreates?: ProposedFolderCreate[];
  timestamp: number;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  pinned: boolean;
};

export type KayaDocument = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  lastReviewed?: string;
  folderId?: string | null;
};

export type SSEEvent =
  | { type: "TextChunk"; content: string }
  | { type: "CitationFound"; docId: string; paragraphId: string; label: number; title: string }
  | { type: "ProposedEditEmitted"; editId: string; docId: string; paragraphId: string; original: string; proposed: string }
  | { type: "ProposedDeleteEmitted"; editId: string; docId: string; docTitle: string }
  | { type: "ProposedFolderCreateEmitted"; editId: string; name: string; parentId: string | null }
  | { type: "SessionRenamed"; sessionId: string; title: string }
  | { type: "Done" }
  | { type: "Error"; message: string };
