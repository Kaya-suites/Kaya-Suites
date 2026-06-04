"use client";

import type { MutableRefObject } from "react";
import { flushSync } from "react-dom";
import {
  createDefaultBlock,
  indentBlock,
  inlineHtmlToMarkdown,
  outdentBlock,
  type MarkdownBlock,
} from "@kaya/markdown-model";
import { EditableHtml } from "./EditableHtml";
import { ListBlockEditor } from "./ListBlockEditor";
import { TableBlockEditor } from "./TableBlockEditor";
import { CodeBlockEditor } from "./CodeBlockEditor";
import { getCaretXFromSelection, isCaretAtFirstLine, isCaretAtLastLine, isCaretAtEnd, isCaretAtStart, getSplitHtmlAtSelection, placeCaretAtX } from "./utils/helpers";
import type { SlashState } from "./types";

export type EditorBlockProps = {
  block: MarkdownBlock;
  blockIndex: number;
  blocks: MarkdownBlock[];
  active: boolean;
  slashMenuOpen: boolean;
  setActiveBlockId: (id: string) => void;
  updateBlock: (blockId: string, updater: (block: MarkdownBlock) => MarkdownBlock) => void;
  replaceBlock: (blockId: string, nextBlock: MarkdownBlock) => void;
  insertBlockAfter: (blockId: string, block: MarkdownBlock) => void;
  removeBlock: (blockId: string) => void;
  focusEditable: (blockId: string) => void;
  focusEditableAtStart: (blockId: string) => void;
  focusEditableAtEnd: (blockId: string) => void;
  focusBlockAtStart: (blockId: string) => void;
  focusBlockAtEnd: (blockId: string) => void;
  editableRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  caretXRef: MutableRefObject<number | null>;
  rememberSelection: (blockId?: string | null) => void;
  onSlashInput: (blockId: string, text: string) => void;
  setSlashState: (value: SlashState | null) => void;
  splitEditableTextBlock: (blockId: string, split: { beforeHtml: string; afterHtml: string }) => void;
  mergeWithPrevious: (blockId: string) => void;
  mergeListItemWithPrevious: (listBlockId: string) => void;
  clearSelection: () => void;
  isComposing: () => boolean;
};

export function renderEditorBlock({
  block,
  blockIndex,
  blocks,
  active,
  slashMenuOpen,
  setActiveBlockId,
  updateBlock,
  replaceBlock,
  insertBlockAfter,
  removeBlock,
  focusEditable,
  focusEditableAtStart,
  focusEditableAtEnd,
  focusBlockAtStart,
  focusBlockAtEnd,
  editableRefs,
  caretXRef,
  rememberSelection,
  onSlashInput,
  setSlashState,
  splitEditableTextBlock,
  mergeWithPrevious,
  mergeListItemWithPrevious,
  clearSelection,
  isComposing,
}: EditorBlockProps) {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
    case "heading": {
      const Tag = block.type === "heading" ? (`h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6") : "div";
      const className =
        block.type === "paragraph"
          ? "min-h-8 text-sm font-mono leading-relaxed focus:outline-none [&_a]:font-bold [&_a]:text-[var(--color-accent)] [&_a]:underline"
          : block.type === "blockquote"
            ? "min-h-8 border-l-4 border-black bg-[var(--color-muted-bg)] px-4 py-3 text-sm font-mono leading-relaxed focus:outline-none [&_a]:font-bold [&_a]:text-[var(--color-accent)] [&_a]:underline"
            : block.level === 1
              ? "min-h-10 text-3xl font-bold font-mono focus:outline-none [&_a]:text-[var(--color-accent)] [&_a]:underline"
              : block.level === 2
                ? "min-h-9 text-xl font-bold font-mono focus:outline-none [&_a]:text-[var(--color-accent)] [&_a]:underline"
                : "min-h-8 text-lg font-bold font-mono focus:outline-none [&_a]:text-[var(--color-accent)] [&_a]:underline";

      return (
        <div style={{ paddingLeft: `${block.depth * 1.5}rem`, borderLeft: block.depth > 0 ? "2px solid var(--color-muted)" : undefined }}>
          <EditableHtml
          html={block.html}
          tagName={Tag}
          className={className}
          dataBlockId={block.id}
          registerRef={(node) => {
            if (node) editableRefs.current.set(block.id, node);
            else editableRefs.current.delete(block.id);
          }}
          onFocus={() => {
            clearSelection();
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
            // B3: don't run any block-level shortcuts while an IME is composing.
            if (isComposing()) return;
            if (event.key === "Tab") {
              event.preventDefault();
              if (event.shiftKey) {
                replaceBlock(block.id, outdentBlock(block));
              } else {
                replaceBlock(block.id, indentBlock(block));
              }
              return;
            }

            if (event.key === "/" && (event.currentTarget.textContent ?? "").trim() === "") {
              setSlashState({ blockId: block.id, query: "" });
            }

            if (event.key === " ") {
              const text = (event.currentTarget.textContent ?? "");
              const trimmed = text.trim();
              const headingMatch = trimmed.match(/^(#{1,6})$/);
              if (headingMatch) {
                event.preventDefault();
                const level = Math.min(headingMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
                replaceBlock(block.id, { id: block.id, type: "heading", level, html: "", depth: 0 });
                focusEditableAtStart(block.id);
                return;
              }
              if (trimmed === ">") {
                event.preventDefault();
                replaceBlock(block.id, { id: block.id, type: "blockquote", html: "", depth: 0 });
                focusEditableAtStart(block.id);
                return;
              }
              if (trimmed === "1.") {
                event.preventDefault();
                replaceBlock(block.id, {
                  id: block.id,
                  type: "list",
                  ordered: true,
                  start: 1,
                  items: [{ id: `${block.id}-li`, depth: 0, ordered: true, checked: null, html: "" }],
                });
                return;
              }
              if (trimmed === "-" || trimmed === "*" || trimmed === "+") {
                event.preventDefault();
                replaceBlock(block.id, {
                  id: block.id,
                  type: "list",
                  ordered: false,
                  start: 1,
                  items: [{ id: `${block.id}-li`, depth: 0, ordered: false, checked: null, html: "" }],
                });
                return;
              }
              const taskMatch = trimmed.match(/^\[( |x|X)?\]$/);
              if (taskMatch) {
                event.preventDefault();
                replaceBlock(block.id, {
                  id: block.id,
                  type: "list",
                  ordered: false,
                  start: 1,
                  items: [{ id: `${block.id}-li`, depth: 0, ordered: false, checked: taskMatch[1]?.toLowerCase() === "x", html: "" }],
                });
                return;
              }
              if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
                event.preventDefault();
                replaceBlock(block.id, { id: block.id, type: "hr" });
                const next = createDefaultBlock("paragraph");
                insertBlockAfter(block.id, next);
                focusEditableAtStart(next.id);
                return;
              }
              if (trimmed === "```") {
                event.preventDefault();
                replaceBlock(block.id, { id: block.id, type: "code", language: "", code: "" });
                return;
              }
            }

            if (event.key === "ArrowLeft" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
              caretXRef.current = null;
              if (blockIndex > 0 && isCaretAtStart(event.currentTarget)) {
                event.preventDefault();
                focusBlockAtEnd(blocks[blockIndex - 1].id);
              }
            }

            if (event.key === "ArrowRight" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
              caretXRef.current = null;
              if (blockIndex < blocks.length - 1 && isCaretAtEnd(event.currentTarget)) {
                event.preventDefault();
                focusBlockAtStart(blocks[blockIndex + 1].id);
              }
            }

            if (!slashMenuOpen && event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
              if (isCaretAtFirstLine(event.currentTarget)) {
                event.preventDefault();
                const x = getCaretXFromSelection();
                if (x != null) caretXRef.current = x;
                if (blockIndex > 0) {
                  const prev = blocks[blockIndex - 1];
                  const prevEl = editableRefs.current.get(prev.id);
                  if (prevEl && caretXRef.current != null && placeCaretAtX(prevEl, caretXRef.current, false)) return;
                  focusBlockAtEnd(prev.id);
                } else {
                  focusEditableAtStart(block.id);
                }
              }
            }

            if (!slashMenuOpen && event.key === "ArrowDown" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
              if (isCaretAtLastLine(event.currentTarget)) {
                event.preventDefault();
                const x = getCaretXFromSelection();
                if (x != null) caretXRef.current = x;
                if (blockIndex < blocks.length - 1) {
                  const next = blocks[blockIndex + 1];
                  const nextEl = editableRefs.current.get(next.id);
                  if (nextEl && caretXRef.current != null && placeCaretAtX(nextEl, caretXRef.current, true)) return;
                  focusBlockAtStart(next.id);
                } else {
                  focusEditableAtEnd(block.id);
                }
              }
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const split = getSplitHtmlAtSelection(event.currentTarget);
              if (split && inlineHtmlToMarkdown(split.afterHtml).trim() !== "") {
                splitEditableTextBlock(block.id, split);
                return;
              }

              const next = createDefaultBlock("paragraph");
              flushSync(() => { insertBlockAfter(block.id, next); });
              focusEditableAtStart(next.id);
            }

            if (event.key === "Backspace") {
              if ((event.currentTarget.textContent ?? "") === "") {
                event.preventDefault();
                removeBlock(block.id);
                return;
              }
              if (blockIndex > 0 && isCaretAtStart(event.currentTarget)) {
                event.preventDefault();
                mergeWithPrevious(block.id);
              }
            }
          }}
          onMouseUp={() => rememberSelection(block.id)}
          onKeyUp={() => rememberSelection(block.id)}
        />
        </div>
      );
    }
    case "list":
      return (
        <ListBlockEditor
          block={block}
          blockIndex={blockIndex}
          blocks={blocks}
          active={active}
          focusBlockAtStart={focusBlockAtStart}
          onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
          onChange={(next) => updateBlock(block.id, () => next)}
          replaceBlock={(next) => replaceBlock(block.id, next)}
          insertBlockAfter={(newBlock) => insertBlockAfter(block.id, newBlock)}
          removeBlock={() => removeBlock(block.id)}
          onNavigatePrev={() => {
            if (blockIndex > 0) focusBlockAtEnd(blocks[blockIndex - 1].id);
          }}
          onNavigateNext={() => {
            if (blockIndex < blocks.length - 1) focusBlockAtStart(blocks[blockIndex + 1].id);
          }}
          onMergeWithPrevious={blockIndex > 0 ? () => mergeListItemWithPrevious(block.id) : undefined}
          onSlashTrigger={setSlashState}
        />
      );
    case "table":
      return (
        <TableBlockEditor
          block={block}
          onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
          onChange={(next) => updateBlock(block.id, () => next)}
        />
      );
    case "code":
      return (
        <CodeBlockEditor
          block={block}
          onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
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
                onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, src: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Image URL"
              />
              <input
                value={block.alt}
                onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, alt: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Alt text"
              />
              <input
                value={block.title}
                onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
                onChange={(event) => updateBlock(block.id, (current) => current.type === "image" ? { ...current, title: event.target.value } : current)}
                className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                placeholder="Title"
              />
            </div>
          </div>
        </div>
      );
    case "callout":
      return (
        <div className="flex gap-3 border-2 border-black bg-[var(--color-muted-bg)] px-3 py-3" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
          <input
            value={block.icon}
            onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
            onChange={(e) => updateBlock(block.id, (c) => c.type === "callout" ? { ...c, icon: e.target.value.slice(0, 3) } : c)}
            className="h-8 w-10 border-2 border-black bg-white text-center text-base font-mono"
            style={{ borderRadius: "var(--border-radius)" }}
            aria-label="Callout icon"
          />
          <EditableHtml
            html={block.html}
            tagName="div"
            className="min-h-8 flex-1 text-sm font-mono leading-relaxed focus:outline-none"
            dataBlockId={block.id}
            ariaLabel="Callout body"
            registerRef={(node) => {
              if (node) editableRefs.current.set(block.id, node);
              else editableRefs.current.delete(block.id);
            }}
            onFocus={() => { clearSelection(); setActiveBlockId(block.id); rememberSelection(block.id); }}
            onChange={(html) => updateBlock(block.id, (c) => c.type === "callout" ? { ...c, html } : c)}
            onMouseUp={() => rememberSelection(block.id)}
            onKeyUp={() => rememberSelection(block.id)}
          />
        </div>
      );
    case "toggle":
      return (
        <details open={block.open} onToggle={(e) => {
          const nextOpen = (e.currentTarget as HTMLDetailsElement | null)?.open ?? !block.open;
          updateBlock(block.id, (c) => c.type === "toggle" ? { ...c, open: nextOpen } : c);
        }} className="border-l-2 border-black pl-3">
          <summary className="cursor-pointer">
            <input
              value={block.summary}
              onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
              onChange={(e) => updateBlock(block.id, (c) => c.type === "toggle" ? { ...c, summary: e.target.value } : c)}
              className="border-b-2 border-transparent bg-transparent text-sm font-bold font-mono focus:border-black focus:outline-none"
              placeholder="Toggle summary"
              aria-label="Toggle summary"
            />
          </summary>
          <EditableHtml
            html={block.html}
            tagName="div"
            className="mt-2 min-h-8 text-sm font-mono leading-relaxed focus:outline-none"
            dataBlockId={block.id}
            ariaLabel="Toggle body"
            registerRef={(node) => {
              if (node) editableRefs.current.set(block.id, node);
              else editableRefs.current.delete(block.id);
            }}
            onFocus={() => { clearSelection(); setActiveBlockId(block.id); rememberSelection(block.id); }}
            onChange={(html) => updateBlock(block.id, (c) => c.type === "toggle" ? { ...c, html } : c)}
            onMouseUp={() => rememberSelection(block.id)}
            onKeyUp={() => rememberSelection(block.id)}
          />
        </details>
      );
    case "hr":
      return <hr className="my-4 border-0 border-t-2 border-black" />;
    case "html":
      return (
        <textarea
          value={block.source}
          onFocus={() => { clearSelection(); setActiveBlockId(block.id); }}
          onChange={(event) => updateBlock(block.id, (current) => current.type === "html" ? { ...current, source: event.target.value } : current)}
          rows={6}
          className="w-full border-2 border-black bg-[var(--color-muted-bg)] px-4 py-3 text-sm font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        />
      );
  }
}
