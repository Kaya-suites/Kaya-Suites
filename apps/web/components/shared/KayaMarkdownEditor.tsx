"use client";

import {
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addTableColumn,
  addTableRow,
  createDefaultBlock,
  indentListItem,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  moveBlock,
  normalizeBlockHtml,
  outdentListItem,
  parseMarkdownToBlocks,
  removeListItem,
  removeTableColumn,
  removeTableRow,
  serializeBlocksToMarkdown,
  splitListItem,
  toggleTableHeader,
  type MarkdownBlock,
  type MarkdownListItem,
} from "@/lib/markdown/model";
import { MarkdownContent } from "./markdown/MarkdownContent";
import { MermaidDiagram } from "./markdown/MermaidDiagram";

type Props = {
  markdown: string;
  onChange: (value: string) => void;
};

type SlashState = {
  blockId: string;
  query: string;
};

type LinkDialogState = {
  blockId: string;
  href: string;
  open: boolean;
};

type ImageDialogState = {
  open: boolean;
  alt: string;
  src: string;
  title: string;
};

type DropIndicatorState = {
  blockId: string;
  position: "before" | "after";
};

type SlashCommand = {
  key: string;
  label: string;
  description: string;
  build: () => MarkdownBlock;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { key: "text", label: "Text", description: "Plain paragraph", build: () => createDefaultBlock("paragraph") },
  { key: "h1", label: "Heading 1", description: "Large section title", build: () => ({ ...createDefaultBlock("heading"), level: 1 }) },
  { key: "h2", label: "Heading 2", description: "Secondary heading", build: () => ({ ...createDefaultBlock("heading"), level: 2 }) },
  { key: "quote", label: "Quote", description: "Callout style quote", build: () => createDefaultBlock("blockquote") },
  { key: "bullet", label: "Bulleted List", description: "Simple bullet list", build: () => createDefaultBlock("list") },
  {
    key: "numbered",
    label: "Numbered List",
    description: "Ordered list",
    build: () => ({ ...createDefaultBlock("list"), ordered: true }),
  },
  {
    key: "todo",
    label: "Task List",
    description: "Checklist items",
    build: () => ({
      ...createDefaultBlock("list"),
      items: [{ id: `li-task-${Date.now()}`, depth: 0, checked: false, html: "" }],
    }),
  },
  { key: "table", label: "Table", description: "Structured data grid", build: () => createDefaultBlock("table") },
  { key: "code", label: "Code Block", description: "Language-aware code", build: () => createDefaultBlock("code") },
  { key: "image", label: "Image", description: "Image with URL or upload", build: () => createDefaultBlock("image") },
  { key: "divider", label: "Divider", description: "Horizontal rule", build: () => createDefaultBlock("hr") },
  { key: "html", label: "HTML", description: "Raw HTML token block", build: () => createDefaultBlock("html") },
];

const CODE_LANGUAGE_OPTIONS = [
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

function icon(label: string) {
  return <span className="inline-flex h-5 min-w-5 items-center justify-center border border-black bg-white px-1 text-[10px] font-bold">{label}</span>;
}

function getTextBlockHtml(block: MarkdownBlock) {
  if (block.type === "paragraph" || block.type === "blockquote" || block.type === "heading") {
    return block.html;
  }
  return "";
}

async function uploadImageFile(file: File) {
  // TODO: Replace this with the real upload pipeline when storage is finalized.
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function blockLabel(block: MarkdownBlock) {
  switch (block.type) {
    case "paragraph":
      return "Paragraph";
    case "heading":
      return `H${block.level}`;
    case "blockquote":
      return "Quote";
    case "list":
      return block.ordered ? "Numbered" : block.items.some((item) => item.checked !== null) ? "Tasks" : "Bullets";
    case "table":
      return "Table";
    case "code":
      return "Code";
    case "image":
      return "Image";
    case "hr":
      return "Divider";
    case "html":
      return "HTML";
  }
}

function renderBlockTypeOptions() {
  return (
    <>
      <option value="paragraph">Paragraph</option>
      <option value="heading-1">Heading 1</option>
      <option value="heading-2">Heading 2</option>
      <option value="heading-3">Heading 3</option>
      <option value="blockquote">Quote</option>
      <option value="list-bullet">Bulleted List</option>
      <option value="list-numbered">Numbered List</option>
      <option value="list-task">Task List</option>
      <option value="table">Table</option>
      <option value="code">Code Block</option>
      <option value="image">Image</option>
      <option value="hr">Divider</option>
      <option value="html">HTML</option>
    </>
  );
}

export function KayaMarkdownEditor({ markdown, onChange }: Props) {
  const [blocks, setBlocks] = useState<MarkdownBlock[]>(() => parseMarkdownToBlocks(markdown));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [slashState, setSlashState] = useState<SlashState | null>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [imageDialog, setImageDialog] = useState<ImageDialogState>({ open: false, alt: "", src: "", title: "" });
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState<string | null>(null);
  const [slashMenuPos, setSlashMenuPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const lastEmittedRef = useRef(markdown);
  const editableRefs = useRef(new Map<string, HTMLDivElement>());
  const selectionRangeRef = useRef<Range | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeBlockIndex = useMemo(
    () => blocks.findIndex((block) => block.id === activeBlockId),
    [activeBlockId, blocks],
  );
  const activeBlock = activeBlockIndex >= 0 ? blocks[activeBlockIndex] : null;

  useEffect(() => {
    if (markdown !== lastEmittedRef.current) {
      setBlocks(parseMarkdownToBlocks(markdown));
      lastEmittedRef.current = markdown;
    }
  }, [markdown]);

  useEffect(() => {
    const serialized = serializeBlocksToMarkdown(blocks);
    if (serialized !== lastEmittedRef.current) {
      lastEmittedRef.current = serialized;
      onChange(serialized);
    }
  }, [blocks, onChange]);

  useLayoutEffect(() => {
    if (!slashState) { setSlashMenuPos(null); return; }
    const node = editableRefs.current.get(slashState.blockId);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setSlashMenuPos(
      spaceBelow > 220
        ? { top: rect.bottom + 8, left: Math.max(8, rect.left) }
        : { bottom: window.innerHeight - rect.top + 8, left: Math.max(8, rect.left) },
    );
  }, [slashState]);

  useEffect(() => {
    if (!blockMenuOpen) return;
    function handleGlobalClick() { setBlockMenuOpen(null); }
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, [blockMenuOpen]);

  function updateBlock(blockId: string, updater: (block: MarkdownBlock) => MarkdownBlock) {
    setBlocks((current) =>
      current.map((block) => (block.id === blockId ? normalizeBlockHtml(updater(block)) : block)),
    );
  }

  function insertBlockAfter(blockId: string, block: MarkdownBlock) {
    setBlocks((current) => {
      const index = current.findIndex((item) => item.id === blockId);
      if (index === -1) return [...current, block];
      const next = [...current];
      next.splice(index + 1, 0, block);
      return next;
    });
    setActiveBlockId(block.id);
  }

  function replaceBlock(blockId: string, nextBlock: MarkdownBlock) {
    setBlocks((current) => current.map((block) => (block.id === blockId ? nextBlock : block)));
    setActiveBlockId(nextBlock.id);
  }

  function removeBlock(blockId: string) {
    setBlocks((current) => {
      if (current.length === 1) return [createDefaultBlock("paragraph")];
      return current.filter((block) => block.id !== blockId);
    });
  }

  function focusEditable(blockId: string) {
    window.requestAnimationFrame(() => {
      const node = editableRefs.current.get(blockId);
      node?.focus();
    });
  }

  function syncEditableBlock(blockId: string) {
    const node = editableRefs.current.get(blockId);
    if (!node) return;
    updateBlock(blockId, (block) => {
      if (block.type === "paragraph" || block.type === "blockquote" || block.type === "heading") {
        return { ...block, html: node.innerHTML };
      }
      return block;
    });
  }

  function rememberSelection(blockId = activeBlockId) {
    if (!blockId) return;
    const node = editableRefs.current.get(blockId);
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;
    selectionRangeRef.current = range.cloneRange();
  }

  function restoreSelection(blockId = activeBlockId) {
    if (!blockId) return false;
    const node = editableRefs.current.get(blockId);
    if (!node) return false;
    node.focus();
    const selection = window.getSelection();
    const range = selectionRangeRef.current;
    if (!selection || !range) return true;
    selection.removeAllRanges();
    selection.addRange(range.cloneRange());
    return true;
  }

  function applyInlineCommand(command: string, value?: string) {
    if (!activeBlockId) return;
    const block = blocks.find((item) => item.id === activeBlockId);
    if (!block || (block.type !== "paragraph" && block.type !== "heading" && block.type !== "blockquote")) return;
    if (!restoreSelection(activeBlockId)) return;
    document.execCommand(command, false, value);
    rememberSelection(activeBlockId);
    syncEditableBlock(activeBlockId);
  }

  function updateActiveBlockType(value: string) {
    if (!activeBlock) return;

    if (value.startsWith("heading-")) {
      const level = Number.parseInt(value.split("-")[1] ?? "2", 10) as 1 | 2 | 3;
      const html = getTextBlockHtml(activeBlock);
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "heading", level, html });
      focusEditable(activeBlock.id);
      return;
    }

    if (value === "paragraph") {
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "paragraph", html: getTextBlockHtml(activeBlock) });
      focusEditable(activeBlock.id);
      return;
    }

    if (value === "blockquote") {
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "blockquote", html: getTextBlockHtml(activeBlock) });
      focusEditable(activeBlock.id);
      return;
    }

    if (value === "list-bullet" || value === "list-numbered" || value === "list-task") {
      const text = inlineHtmlToMarkdown(getTextBlockHtml(activeBlock));
      replaceBlock(activeBlock.id, {
        id: activeBlock.id,
        type: "list",
        ordered: value === "list-numbered",
        start: 1,
        items: [
          {
            id: `${activeBlock.id}-li`,
            depth: 0,
            checked: value === "list-task" ? false : null,
            html: inlineMarkdownToHtml(text),
          },
        ],
      });
      return;
    }

    replaceBlock(activeBlock.id, { ...createDefaultBlock(value as MarkdownBlock["type"]), id: activeBlock.id });
  }

  function onSlashInput(blockId: string, text: string) {
    const query = text.trim();
    if (query.startsWith("/")) {
      setSlashState({ blockId, query: query.slice(1).toLowerCase() });
    } else if (slashState?.blockId === blockId) {
      setSlashState(null);
    }
  }

  function applySlashCommand(command: SlashCommand) {
    if (!slashState) return;
    const nextBlock = command.build();
    replaceBlock(slashState.blockId, nextBlock);
    setSlashState(null);
    if (nextBlock.type === "paragraph" || nextBlock.type === "heading" || nextBlock.type === "blockquote") {
      focusEditable(nextBlock.id);
    }
  }

  function openLinkDialog() {
    if (!activeBlockId) return;
    rememberSelection(activeBlockId);
    setLinkDialog({ blockId: activeBlockId, href: "", open: true });
  }

  function saveLink() {
    if (!linkDialog?.href) return;
    applyInlineCommand("createLink", linkDialog.href);
    setLinkDialog(null);
  }

  async function insertImageFromFile(file: File) {
    const src = await uploadImageFile(file);
    const next = {
      ...createDefaultBlock("image"),
      src,
      alt: file.name.replace(/\.[^.]+$/, ""),
    };
    if (activeBlockId) {
      insertBlockAfter(activeBlockId, next);
    } else {
      setBlocks((current) => [...current, next]);
      setActiveBlockId(next.id);
    }
  }

  async function handleRootDrop(event: DragEvent<HTMLDivElement>) {
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    await insertImageFromFile(file);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    void insertImageFromFile(file);
  }

  const filteredCommands = slashState
    ? SLASH_COMMANDS.filter((command) =>
        command.label.toLowerCase().includes(slashState.query) ||
        command.description.toLowerCase().includes(slashState.query),
      )
    : [];

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${isFullscreen ? "mx-auto w-full max-w-5xl px-8 py-6" : ""}`}
      onDrop={handleRootDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={handlePaste}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void insertImageFromFile(file);
          event.target.value = "";
        }}
      />

      <div className="sticky top-0 z-20 border-b-2 border-black bg-[var(--color-background)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={
              activeBlock?.type === "heading"
                ? `heading-${activeBlock.level}`
                : activeBlock?.type === "list"
                  ? activeBlock.ordered
                    ? "list-numbered"
                    : activeBlock.items.some((item) => item.checked !== null)
                      ? "list-task"
                      : "list-bullet"
                  : activeBlock?.type ?? "paragraph"
            }
            onChange={(event) => updateActiveBlockType(event.target.value)}
            className="border-2 border-black bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
          >
            {renderBlockTypeOptions()}
          </select>

          <ToolbarButton label="B" onClick={() => applyInlineCommand("bold")} />
          <ToolbarButton label="I" onClick={() => applyInlineCommand("italic")} />
          <ToolbarButton label="S" onClick={() => applyInlineCommand("strikeThrough")} />
          <ToolbarButton label="`Code`" onClick={() => applyInlineCommand("insertHTML", `<code>${window.getSelection()?.toString() ?? ""}</code>`)} />
          <ToolbarButton label="Link" onClick={openLinkDialog} />
          <ToolbarButton label="UL" onClick={() => updateActiveBlockType("list-bullet")} />
          <ToolbarButton label="OL" onClick={() => updateActiveBlockType("list-numbered")} />
          <ToolbarButton label="Task" onClick={() => updateActiveBlockType("list-task")} />
          <ToolbarButton label="Table" onClick={() => activeBlockId && insertBlockAfter(activeBlockId, createDefaultBlock("table"))} />
          <ToolbarButton label="Code Block" onClick={() => activeBlockId && insertBlockAfter(activeBlockId, createDefaultBlock("code"))} />
          <ToolbarButton
            label="Image"
            onClick={() => setImageDialog({ open: true, alt: "", src: "", title: "" })}
          />
          <ToolbarButton label={isReadOnly ? "Edit" : "View"} onClick={() => setIsReadOnly((value) => !value)} />
          <ToolbarButton label={isFullscreen ? "Window" : "Focus"} onClick={() => setIsFullscreen((value) => !value)} />
        </div>
      </div>

      {linkDialog?.open && (
        <Dialog title="Insert Link" onClose={() => setLinkDialog(null)}>
          <input
            value={linkDialog.href}
            onChange={(event) => setLinkDialog((current) => (current ? { ...current, href: event.target.value } : current))}
            className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
            placeholder="https://example.com"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setLinkDialog(null)}
              className="border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide font-mono"
              style={{ borderRadius: "var(--border-radius)" }}
            >
              Cancel
            </button>
            <button
              onClick={saveLink}
              className="border-2 border-black bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Apply
            </button>
          </div>
        </Dialog>
      )}

      {imageDialog.open && (
        <Dialog title="Insert Image" onClose={() => setImageDialog({ open: false, alt: "", src: "", title: "" })}>
          <div className="grid gap-3">
            <input
              value={imageDialog.src}
              onChange={(event) => setImageDialog((current) => ({ ...current, src: event.target.value }))}
              className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              placeholder="Image URL"
            />
            <input
              value={imageDialog.alt}
              onChange={(event) => setImageDialog((current) => ({ ...current, alt: event.target.value }))}
              className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              placeholder="Alt text"
            />
            <input
              value={imageDialog.title}
              onChange={(event) => setImageDialog((current) => ({ ...current, title: event.target.value }))}
              className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              placeholder="Title"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide font-mono"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                Choose File
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setImageDialog({ open: false, alt: "", src: "", title: "" })}
                className="border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide font-mono"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const next = { ...createDefaultBlock("image"), src: imageDialog.src, alt: imageDialog.alt, title: imageDialog.title };
                  if (activeBlockId) {
                    insertBlockAfter(activeBlockId, next);
                  } else {
                    setBlocks((current) => [...current, next]);
                    setActiveBlockId(next.id);
                  }
                  setImageDialog({ open: false, alt: "", src: "", title: "" });
                }}
                className="border-2 border-black bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
              >
                Insert
              </button>
            </div>
          </div>
        </Dialog>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isReadOnly ? (
          <div className="mx-auto w-full max-w-4xl">
            <MarkdownContent markdown={serializeBlocksToMarkdown(blocks)} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {blocks.map((block, index) => (
              <BlockShell
                key={block.id}
                block={block}
                index={index}
                active={block.id === activeBlockId}
                onActivate={() => setActiveBlockId(block.id)}
                onInsert={() => insertBlockAfter(block.id, createDefaultBlock("paragraph"))}
                onDelete={() => removeBlock(block.id)}
                onDuplicate={() => insertBlockAfter(block.id, { ...createDefaultBlock(block.type), ...block, id: `${block.id}-copy-${Date.now()}` })}
                menuOpen={blockMenuOpen === block.id}
                onMenuToggle={() => setBlockMenuOpen((prev) => (prev === block.id ? null : block.id))}
                onDragStart={() => {
                  dragIndexRef.current = index;
                  setDraggingBlockId(block.id);
                  setBlockMenuOpen(null);
                }}
                onDragEnd={() => {
                  dragIndexRef.current = null;
                  setDraggingBlockId(null);
                  setDropIndicator(null);
                }}
                onDragOverBlock={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const midpoint = rect.top + rect.height / 2;
                  setDropIndicator({
                    blockId: block.id,
                    position: event.clientY < midpoint ? "before" : "after",
                  });
                }}
                onDrop={() => {
                  if (dragIndexRef.current === null || !dropIndicator) return;
                  const fromIndex = dragIndexRef.current;
                  const targetIndex = index + (dropIndicator.position === "after" ? 1 : 0);
                  const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
                  if (fromIndex === adjustedIndex) {
                    dragIndexRef.current = null;
                    setDraggingBlockId(null);
                    setDropIndicator(null);
                    return;
                  }
                  setBlocks((current) => moveBlock(current, fromIndex, adjustedIndex));
                  dragIndexRef.current = null;
                  setDraggingBlockId(null);
                  setDropIndicator(null);
                }}
                showDropBefore={dropIndicator?.blockId === block.id && dropIndicator.position === "before"}
                showDropAfter={dropIndicator?.blockId === block.id && dropIndicator.position === "after"}
                isDragging={draggingBlockId === block.id}
              >
                {renderEditorBlock({
                  block,
                  active: block.id === activeBlockId,
                  setActiveBlockId,
                  updateBlock,
                  insertBlockAfter,
                  removeBlock,
                  focusEditable,
                  editableRefs,
                  rememberSelection,
                  onSlashInput,
                  setSlashState,
                })}
              </BlockShell>
            ))}
          </div>
        )}
      </div>

      {slashState && filteredCommands.length > 0 && !isReadOnly && slashMenuPos && (
        <div
          className="fixed z-30 w-72 border-2 border-black bg-[var(--color-surface)] p-2"
          style={{ ...slashMenuPos, borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        >
          <div className="border-b-2 border-black px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-muted)] font-mono">
            Slash Commands
          </div>
          <div className="mt-2 space-y-1">
            {filteredCommands.map((command) => (
              <button
                key={command.key}
                onClick={() => applySlashCommand(command)}
                className="flex w-full items-center gap-2 border-2 border-transparent px-2 py-2 text-left hover:border-black hover:bg-[var(--color-muted-bg)]"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                {icon(command.label.slice(0, 2).toUpperCase())}
                <span className="flex-1">
                  <span className="block text-xs font-bold uppercase tracking-wide font-mono">{command.label}</span>
                  <span className="block text-xs text-[var(--color-muted)] font-mono">{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockShell({
  block,
  index,
  active,
  children,
  onActivate,
  onInsert,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragEnd,
  onDragOverBlock,
  onDrop,
  showDropBefore,
  showDropAfter,
  isDragging,
  menuOpen,
  onMenuToggle,
}: {
  block: MarkdownBlock;
  index: number;
  active: boolean;
  children: ReactNode;
  onActivate: () => void;
  onInsert: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverBlock: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  showDropBefore: boolean;
  showDropAfter: boolean;
  isDragging: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <div
      className={`group relative pl-12 ${active ? "z-10" : ""}`}
      onClick={onActivate}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOverBlock(event);
      }}
    >
      {showDropBefore && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center pl-12">
          <div className="h-1 w-full bg-[var(--color-accent)] shadow-[0_0_0_2px_black]" />
        </div>
      )}

      <div className="absolute inset-y-0 left-0 w-10" />
      <div className="absolute left-0 top-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onInsert(); }}
          className="flex h-8 w-8 items-center justify-center border-2 border-black bg-white text-sm font-bold hover:bg-[var(--color-muted-bg)]"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          title="Insert block below"
        >
          +
        </button>
        <div className="relative">
          <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
            className="flex h-8 w-8 items-center justify-center border-2 border-black bg-white text-sm font-bold hover:bg-[var(--color-muted-bg)]"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            title={`Options for ${blockLabel(block)} block ${index + 1}`}
          >
            ⋮⋮
          </button>
          {menuOpen && (
            <div
              className="absolute left-10 top-0 z-30 min-w-36 border-2 border-black bg-[var(--color-surface)] py-1"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => { onDuplicate(); onMenuToggle(); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide font-mono hover:bg-[var(--color-muted-bg)]"
              >
                Duplicate
              </button>
              <div className="mx-2 border-t border-black/10" />
              <button
                type="button"
                onClick={() => { onDelete(); onMenuToggle(); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide font-mono text-[var(--color-danger)] hover:bg-[var(--color-muted-bg)]"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={`border-l-2 pl-2 transition-[border-color,opacity] ${active ? "border-l-[var(--color-accent)]" : "border-l-transparent"} ${isDragging ? "opacity-45" : "opacity-100"}`}
      >
        {children}
      </div>

      {showDropAfter && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center pl-12">
          <div className="h-1 w-full bg-[var(--color-accent)] shadow-[0_0_0_2px_black]" />
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="border-2 border-black bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide font-mono"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
    >
      {label}
    </button>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg border-2 border-black bg-[var(--color-surface)] p-4"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b-2 border-black pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wide font-mono">{title}</h3>
          <button onClick={onClose} className="border-2 border-black px-2 py-1 text-xs font-bold uppercase font-mono" style={{ borderRadius: "var(--border-radius)" }}>
            Close
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function EditableHtml({
  html,
  className,
  tagName = "div",
  onFocus,
  onChange,
  onKeyDown,
  onMouseUp,
  onKeyUp,
  registerRef,
}: {
  html: string;
  className: string;
  tagName?: "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  onChange: (html: string, text: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMouseUp?: () => void;
  onKeyUp?: () => void;
  registerRef?: (node: HTMLDivElement | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (node.innerHTML !== html) {
      node.innerHTML = html;
    }
  }, [html]);

  const Tag = tagName;

  return (
    <Tag
      contentEditable
      suppressContentEditableWarning
      ref={(node: HTMLDivElement | null) => {
        ref.current = node;
        registerRef?.(node);
      }}
      className={className}
      onFocus={onFocus}
      onInput={(event) => {
        const node = event.currentTarget;
        onChange(node.innerHTML, node.textContent ?? "");
      }}
      onKeyDown={onKeyDown}
      onMouseUp={onMouseUp}
      onKeyUp={onKeyUp}
    />
  );
}

function renderEditorBlock({
  block,
  active,
  setActiveBlockId,
  updateBlock,
  insertBlockAfter,
  removeBlock,
  focusEditable,
  editableRefs,
  rememberSelection,
  onSlashInput,
  setSlashState,
}: {
  block: MarkdownBlock;
  active: boolean;
  setActiveBlockId: (id: string) => void;
  updateBlock: (blockId: string, updater: (block: MarkdownBlock) => MarkdownBlock) => void;
  insertBlockAfter: (blockId: string, block: MarkdownBlock) => void;
  removeBlock: (blockId: string) => void;
  focusEditable: (blockId: string) => void;
  editableRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  rememberSelection: (blockId?: string | null) => void;
  onSlashInput: (blockId: string, text: string) => void;
  setSlashState: (value: SlashState | null) => void;
}) {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
    case "heading": {
      const Tag = block.type === "heading" ? (`h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6") : "div";
      const className =
        block.type === "paragraph"
          ? "min-h-8 text-sm font-mono leading-relaxed focus:outline-none"
          : block.type === "blockquote"
            ? "min-h-8 border-l-4 border-black bg-[var(--color-muted-bg)] px-4 py-3 text-sm font-mono leading-relaxed focus:outline-none"
            : block.level === 1
              ? "min-h-10 text-3xl font-bold font-mono focus:outline-none"
              : block.level === 2
                ? "min-h-9 text-xl font-bold font-mono focus:outline-none"
                : "min-h-8 text-lg font-bold font-mono focus:outline-none";

      return (
        <EditableHtml
          html={block.html}
          tagName={Tag}
          className={className}
          registerRef={(node) => {
            if (node) editableRefs.current.set(block.id, node);
            else editableRefs.current.delete(block.id);
          }}
          onFocus={() => {
            setActiveBlockId(block.id);
            rememberSelection(block.id);
          }}
          onChange={(html, text) => {
            updateBlock(block.id, (current) => {
              if (current.type === "paragraph" || current.type === "blockquote" || current.type === "heading") {
                return { ...current, html };
              }
              return current;
            });
            onSlashInput(block.id, text.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "/" && (event.currentTarget.textContent ?? "").trim() === "") {
              setSlashState({ blockId: block.id, query: "" });
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const next = createDefaultBlock("paragraph");
              insertBlockAfter(block.id, next);
              focusEditable(next.id);
            }

            if (event.key === "Backspace" && (event.currentTarget.textContent ?? "") === "") {
              event.preventDefault();
              removeBlock(block.id);
            }
          }}
          onMouseUp={() => rememberSelection(block.id)}
          onKeyUp={() => rememberSelection(block.id)}
        />
      );
    }
    case "list":
      return (
        <ListBlockEditor
          block={block}
          active={active}
          onFocus={() => setActiveBlockId(block.id)}
          onChange={(next) => updateBlock(block.id, () => next)}
        />
      );
    case "table":
      return (
        <TableBlockEditor
          block={block}
          onFocus={() => setActiveBlockId(block.id)}
          onChange={(next) => updateBlock(block.id, () => next)}
        />
      );
    case "code":
      return (
        <CodeBlockEditor
          block={block}
          onFocus={() => setActiveBlockId(block.id)}
          onChange={(next) => updateBlock(block.id, () => next)}
        />
      );
    case "image":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
            <div className="border-2 border-dashed border-black bg-white p-3" style={{ borderRadius: "var(--border-radius)" }}>
              {block.src ? (
                <img src={block.src} alt={block.alt} className="max-h-80 w-full object-contain" />
              ) : (
                <div className="flex h-48 items-center justify-center text-xs uppercase tracking-wide text-[var(--color-muted)] font-mono">
                  Image Preview
                </div>
              )}
            </div>
            <div className="space-y-2">
              <input
                value={block.src}
                onFocus={() => setActiveBlockId(block.id)}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, src: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Image URL"
              />
              <input
                value={block.alt}
                onFocus={() => setActiveBlockId(block.id)}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, alt: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Alt text"
              />
              <input
                value={block.title}
                onFocus={() => setActiveBlockId(block.id)}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, title: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Title"
              />
            </div>
          </div>
        </div>
      );
    case "hr":
      return <hr className="my-4 border-0 border-t-2 border-black" />;
    case "html":
      return (
        <textarea
          value={block.source}
          onFocus={() => setActiveBlockId(block.id)}
          onChange={(event) => updateBlock(block.id, (current) => current.type === "html" ? { ...current, source: event.target.value } : current)}
          rows={6}
          className="w-full border-2 border-black bg-[var(--color-muted-bg)] px-4 py-3 text-sm font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        />
      );
  }
}

function ListBlockEditor({
  block,
  active,
  onFocus,
  onChange,
}: {
  block: Extract<MarkdownBlock, { type: "list" }>;
  active: boolean;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "list" }>) => void;
}) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  function focusItem(itemId: string) {
    window.requestAnimationFrame(() => itemRefs.current.get(itemId)?.focus());
  }

  function updateItem(itemIndex: number, updater: (item: MarkdownListItem) => MarkdownListItem) {
    onChange({
      ...block,
      items: block.items.map((item, index) => (index === itemIndex ? updater(item) : item)),
    });
  }

  function itemPrefix(item: MarkdownListItem, itemIndex: number) {
    if (item.checked !== null) {
      return (
        <button
          onClick={() => updateItem(itemIndex, (current) => ({ ...current, checked: !current.checked }))}
          className="mt-1 flex h-5 w-5 items-center justify-center border-2 border-black text-[10px] font-bold"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
        >
          {item.checked ? "x" : ""}
        </button>
      );
    }

    if (block.ordered) {
      let number = block.start;
      for (let index = 0; index < itemIndex; index += 1) {
        if (block.items[index].depth === item.depth) number += 1;
      }
      return <span className="mt-1 min-w-6 text-right text-sm font-bold font-mono">{number}.</span>;
    }

    return <span className="mt-1 min-w-4 text-center text-sm font-bold font-mono">•</span>;
  }

  return (
    <div className={`space-y-1 ${active ? "" : ""}`}>
      {block.items.map((item, itemIndex) => (
        <div key={item.id} className="flex gap-2" style={{ paddingLeft: `${item.depth * 1.5}rem` }}>
          {itemPrefix(item, itemIndex)}
          <EditableHtml
            html={item.html}
            className="min-h-8 flex-1 text-sm font-mono leading-relaxed focus:outline-none"
            registerRef={(node) => {
              if (node) itemRefs.current.set(item.id, node);
              else itemRefs.current.delete(item.id);
            }}
            onFocus={onFocus}
            onChange={(html) => {
              updateItem(itemIndex, (current) => ({ ...current, html }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const selection = window.getSelection();
                const text = event.currentTarget.textContent ?? "";
                if (text.trim() === "") {
                  onChange(removeListItem(block, itemIndex));
                  return;
                }

                const offset = selection?.anchorOffset ?? text.length;
                const markdown = inlineHtmlToMarkdown((event.currentTarget as HTMLDivElement).innerHTML);
                const before = inlineMarkdownToHtml(markdown.slice(0, offset));
                const after = inlineMarkdownToHtml(markdown.slice(offset));
                const next = splitListItem(block, itemIndex, before, after);
                onChange(next);
                focusItem(next.items[itemIndex + 1]?.id ?? item.id);
              }

              if (event.key === "Tab") {
                event.preventDefault();
                onChange(event.shiftKey ? outdentListItem(block, itemIndex) : indentListItem(block, itemIndex));
              }

              if (event.key === "Backspace" && (event.currentTarget.textContent ?? "") === "") {
                event.preventDefault();
                onChange(removeListItem(block, itemIndex));
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function TableBlockEditor({
  block,
  onFocus,
  onChange,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "table" }>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableTableWidth, setAvailableTableWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    Array.from({ length: block.header.length }, () => 180),
  );
  const [rowHeights, setRowHeights] = useState<number[]>(() =>
    Array.from({ length: block.rows.length + 1 }, () => 52),
  );
  const visibleColumnWidths = useMemo(
    () => Array.from({ length: block.header.length }, (_, index) => columnWidths[index] ?? 180),
    [block.header.length, columnWidths],
  );
  const visibleRowHeights = useMemo(
    () => Array.from({ length: block.rows.length + 1 }, (_, index) => rowHeights[index] ?? 52),
    [block.rows.length, rowHeights],
  );

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      setAvailableTableWidth(Math.max(0, node.clientWidth));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  function beginColumnResize(columnIndex: number, startX: number) {
    const initialWidth = visibleColumnWidths[columnIndex] ?? 180;

    function handleMove(event: MouseEvent) {
      const width = Math.max(120, initialWidth + event.clientX - startX);
      setColumnWidths((current) => current.map((value, index) => (index === columnIndex ? width : value)));
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function beginRowResize(rowIndex: number, startY: number) {
    const initialHeight = visibleRowHeights[rowIndex] ?? 52;

    function handleMove(event: MouseEvent) {
      const height = Math.max(44, initialHeight + event.clientY - startY);
      setRowHeights((current) => current.map((value, index) => (index === rowIndex ? height : value)));
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function beginTableResize(startX: number) {
    const initialWidths = [...visibleColumnWidths];
    const initialTotalWidth = initialWidths.reduce((sum, width) => sum + width, 0);

    function handleMove(event: MouseEvent) {
      const nextTotalWidth = Math.max(320, initialTotalWidth + event.clientX - startX);
      const scale = nextTotalWidth / initialTotalWidth;
      const resized = initialWidths.map((width) => Math.max(120, Math.round(width * scale)));
      setColumnWidths(resized);
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  const totalTableWidth = visibleColumnWidths.reduce((sum, width) => sum + width, 0);
  const displayTableWidth =
    availableTableWidth > 0 ? Math.max(totalTableWidth, availableTableWidth) : totalTableWidth;
  const displayColumnWidths =
    totalTableWidth > 0 && displayTableWidth > totalTableWidth
      ? visibleColumnWidths.map((width) => (width / totalTableWidth) * displayTableWidth)
      : visibleColumnWidths;
  const tableStyle = {
    width: `${displayTableWidth}px`,
    minWidth: `${displayTableWidth}px`,
  } satisfies CSSProperties;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 border-2 border-black bg-[var(--color-background)] px-3 py-2" style={{ borderRadius: "var(--border-radius)" }}>
        <ToolbarButton label="+ Row" onClick={() => onChange(addTableRow(block, block.rows.length))} />
        <ToolbarButton label="- Row" onClick={() => onChange(removeTableRow(block, block.rows.length - 1))} />
        <ToolbarButton label="+ Col" onClick={() => onChange(addTableColumn(block, block.header.length))} />
        <ToolbarButton label="- Col" onClick={() => onChange(removeTableColumn(block, block.header.length - 1))} />
        <ToolbarButton label="Swap Header" onClick={() => onChange(toggleTableHeader(block))} />
      </div>

      <div
        ref={containerRef}
        className="relative overflow-x-auto border-2 border-black bg-white"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <div style={tableStyle}>
          <div className="relative flex border-b-2 border-black">
            {block.header.map((cell, columnIndex) => (
              <div
                key={`${block.id}-head-${columnIndex}`}
                className="relative border-r-2 border-black bg-[var(--color-muted-bg)]"
                style={{
                  width: `${displayColumnWidths[columnIndex] ?? 180}px`,
                  minHeight: `${visibleRowHeights[0] ?? 52}px`,
                }}
              >
                <textarea
                  value={inlineHtmlToMarkdown(cell)}
                  onFocus={onFocus}
                  ref={(el) => { if (el) autoResizeTextarea(el); }}
                  onChange={(event) => {
                    autoResizeTextarea(event.currentTarget);
                    onChange({
                      ...block,
                      header: block.header.map((value, index) =>
                        index === columnIndex ? inlineMarkdownToHtml(event.target.value) : value,
                      ),
                    });
                  }}
                  className="w-full resize-none bg-transparent px-3 py-2 text-sm font-bold uppercase tracking-wide font-mono outline-none"
                />
                {columnIndex < block.header.length - 1 && (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      beginColumnResize(columnIndex, event.clientX);
                    }}
                    className="absolute right-[-6px] top-0 z-10 h-full w-3 cursor-col-resize"
                    title="Resize column"
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                beginRowResize(0, event.clientY);
              }}
              className="absolute bottom-[-6px] left-0 z-10 h-3 w-full cursor-row-resize"
              title="Resize header row"
            />
          </div>

          {block.rows.map((row, rowIndex) => (
            <div
              key={`${block.id}-row-${rowIndex}`}
              className="relative flex border-b-2 border-black"
              style={{ minHeight: `${visibleRowHeights[rowIndex + 1] ?? 52}px` }}
            >
              {row.map((cell, columnIndex) => (
                <div
                  key={`${block.id}-row-${rowIndex}-col-${columnIndex}`}
                  className="border-r-2 border-black"
                  style={{ width: `${displayColumnWidths[columnIndex] ?? 180}px` }}
                >
                  <textarea
                    value={inlineHtmlToMarkdown(cell)}
                    onFocus={onFocus}
                    ref={(el) => { if (el) autoResizeTextarea(el); }}
                    onChange={(event) => {
                      autoResizeTextarea(event.currentTarget);
                      onChange({
                        ...block,
                        rows: block.rows.map((currentRow, currentRowIndex) =>
                          currentRowIndex === rowIndex
                            ? currentRow.map((value, currentColumnIndex) =>
                                currentColumnIndex === columnIndex ? inlineMarkdownToHtml(event.target.value) : value,
                              )
                            : currentRow,
                        ),
                      });
                    }}
                    className="w-full resize-none px-3 py-2 text-sm font-mono outline-none"
                  />
                </div>
              ))}
              {rowIndex < block.rows.length - 1 && (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    beginRowResize(rowIndex + 1, event.clientY);
                  }}
                  className="absolute bottom-[-6px] left-0 z-10 h-3 w-full cursor-row-resize"
                  title="Resize row"
                />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            beginTableResize(event.clientX);
          }}
          className="absolute right-[-6px] top-0 z-20 h-full w-4 cursor-ew-resize"
          title="Resize table width"
        />
      </div>
    </div>
  );
}

function CodeBlockEditor({
  block,
  onFocus,
  onChange,
}: {
  block: Extract<MarkdownBlock, { type: "code" }>;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "code" }>) => void;
}) {
  return (
    <div className="overflow-hidden border-2 border-black bg-[var(--color-surface)]" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between gap-3 border-b-2 border-black bg-[var(--color-muted-bg)] px-3 py-2">
        <select
          value={block.language}
          onFocus={onFocus}
          onChange={(event) => onChange({ ...block, language: event.target.value })}
          className="w-48 border-2 border-black bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
        >
          {CODE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value || "plain"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-muted)] font-mono">
          {block.language.toLowerCase() === "mermaid" ? "Mermaid Preview Enabled" : "Syntax Highlighted In View Mode"}
        </span>
      </div>
      <textarea
        value={block.code}
        onFocus={onFocus}
        onChange={(event) => onChange({ ...block, code: event.target.value })}
        rows={10}
        className="w-full resize-y bg-[var(--color-surface)] px-4 py-3 text-sm font-mono text-black outline-none"
      />
      {block.language.toLowerCase() === "mermaid" && block.code.trim() && (
        <div className="border-t-2 border-black bg-white p-4">
          <MermaidDiagram code={block.code} className="overflow-auto" />
        </div>
      )}
    </div>
  );
}
