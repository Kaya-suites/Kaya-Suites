import { createDefaultBlock, type MarkdownBlock } from "@kaya/markdown-model";
import type { SlashCommand } from "./types";

export const SLASH_COMMANDS: SlashCommand[] = [
  { key: "text", label: "Text", description: "Plain paragraph", build: () => createDefaultBlock("paragraph") },
  { key: "h1", label: "Heading 1", description: "Large section title", build: () => ({ ...createDefaultBlock("heading"), level: 1 }) },
  { key: "h2", label: "Heading 2", description: "Secondary heading", build: () => ({ ...createDefaultBlock("heading"), level: 2 }) },
  { key: "quote", label: "Quote", description: "Callout style quote", build: () => createDefaultBlock("blockquote") },
  { key: "bullet", label: "Bulleted List", description: "Simple bullet list", build: () => createDefaultBlock("list") },
  {
    key: "numbered",
    label: "Numbered List",
    description: "Ordered list",
    build: () => {
      const base = createDefaultBlock("list") as Extract<MarkdownBlock, { type: "list" }>;
      return { ...base, ordered: true, items: base.items.map((item) => ({ ...item, ordered: true })) };
    },
  },
  {
    key: "todo",
    label: "Task List",
    description: "Checklist items",
    build: () => ({
      ...createDefaultBlock("list"),
      items: [{ id: `li-task-${Date.now()}`, depth: 0, ordered: false, checked: false, html: "" }],
    }),
  },
  { key: "table", label: "Table", description: "Structured data grid", build: () => createDefaultBlock("table") },
  { key: "code", label: "Code Block", description: "Language-aware code", build: () => createDefaultBlock("code") },
  { key: "image", label: "Image", description: "Image with URL or upload", build: () => createDefaultBlock("image") },
  { key: "divider", label: "Divider", description: "Horizontal rule", build: () => createDefaultBlock("hr") },
  { key: "callout", label: "Callout", description: "Highlighted box with an icon", build: () => createDefaultBlock("callout") },
  { key: "toggle", label: "Toggle", description: "Collapsible details block", build: () => createDefaultBlock("toggle") },
  { key: "html", label: "HTML", description: "Raw HTML token block", build: () => createDefaultBlock("html") },
];

export const CODE_LANGUAGE_OPTIONS = [
  { value: "", label: "Plain Text" },
  { value: "js", label: "JavaScript" },
  { value: "ts", label: "TypeScript" },
  { value: "jsx", label: "JSX" },
  { value: "tsx", label: "TSX" },
  { value: "py", label: "Python" },
  { value: "rs", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "json", label: "JSON" },
  { value: "md", label: "Markdown" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "mermaid", label: "Mermaid" },
] as const;
