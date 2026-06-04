"use client";

import { useEffect, useRef } from "react";
import {
  createDefaultBlock,
  indentListItem,
  outdentListItem,
  type MarkdownBlock,
  type MarkdownListItem,
} from "@kaya/markdown-model";
import { EditableHtml } from "./EditableHtml";
import { useEditorContext } from "./EditorContext";
import { computeOrderedNumber, getSplitHtmlAtSelection, isCaretAtFirstLine, isCaretAtLastLine, isCaretAtEnd, isCaretAtStart } from "./utils/helpers";
import type { SlashState } from "./types";

export function ListBlockEditor({
  block,
  blockIndex,
  blocks,
  active,
  focusBlockAtStart,
  onFocus,
  onChange,
  replaceBlock,
  insertBlockAfter,
  removeBlock,
  onNavigatePrev,
  onNavigateNext,
  onMergeWithPrevious,
  onSlashTrigger,
}: {
  block: Extract<MarkdownBlock, { type: "list" }>;
  blockIndex: number;
  blocks: MarkdownBlock[];
  active: boolean;
  focusBlockAtStart: (blockId: string) => void;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "list" }>) => void;
  replaceBlock: (next: MarkdownBlock) => void;
  insertBlockAfter: (newBlock: MarkdownBlock) => void;
  removeBlock: () => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onMergeWithPrevious?: () => void;
  onSlashTrigger?: (state: SlashState | null) => void;
}) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const prevActiveRef = useRef(active);
  const editor = useEditorContext();

  // Auto-focus the item when this block becomes active programmatically (e.g. after Enter inserts it).
  useEffect(() => {
    if (active && !prevActiveRef.current) {
      const firstItem = block.items[0];
      if (firstItem) {
        window.requestAnimationFrame(() => itemRefs.current.get(firstItem.id)?.focus());
      }
    }
    prevActiveRef.current = active;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

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

    if (item.ordered) {
      const number = computeOrderedNumber(blocks, blockIndex, item.depth);
      return (
        <button
          title="Switch to bullet"
          onClick={() => replaceBlock({ ...block, ordered: false, items: [{ ...item, ordered: false }] })}
          className="self-start min-w-6 text-right text-sm font-bold font-mono hover:opacity-50"
        >
          {number}.
        </button>
      );
    }

    return (
      <button
        title="Switch to numbered"
        onClick={() => replaceBlock({ ...block, ordered: true, items: [{ ...item, ordered: true }] })}
        className="min-w-4 text-center text-sm font-bold font-mono hover:opacity-50"
      >
        •
      </button>
    );
  }

  return (
    <div className={`space-y-1 ${active ? "" : ""}`}>
      {block.items.map((item, itemIndex) => (
        <div key={item.id} className="flex gap-2" style={{ paddingLeft: `${item.depth * 1.5}rem` }}>
          {itemPrefix(item, itemIndex)}
          <EditableHtml
            html={item.html}
            className="min-h-8 flex-1 text-sm font-mono leading-relaxed focus:outline-none [&_a]:font-bold [&_a]:text-[var(--color-accent)] [&_a]:underline"
            dataBlockId={block.id}
            dataItemId={item.id}
            registerRef={(node) => {
              if (node) itemRefs.current.set(item.id, node);
              else itemRefs.current.delete(item.id);
            }}
            onFocus={onFocus}
            onChange={(html, text) => {
              updateItem(itemIndex, (current) => ({ ...current, html }));
              if (onSlashTrigger) {
                const t = text.trim();
                if (t.startsWith("/")) onSlashTrigger({ blockId: block.id, query: t.slice(1).toLowerCase(), itemId: item.id });
              }
            }}
            onKeyDown={(event) => {
              // B3: don't run any list-level shortcuts while an IME is composing.
              if (editor.isComposing()) return;
              if (event.key === "/" && (event.currentTarget.textContent ?? "").trim() === "") {
                onSlashTrigger?.({ blockId: block.id, query: "", itemId: item.id });
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const text = event.currentTarget.textContent ?? "";
                if (text.trim() === "") {
                  if (item.depth > 0) {
                    onChange(outdentListItem(block, itemIndex));
                    return;
                  }
                  // Exit list — replace this empty item with a paragraph.
                  removeBlock();
                  const para = createDefaultBlock("paragraph");
                  insertBlockAfter(para);
                  focusBlockAtStart(para.id);
                  return;
                }

                const split = getSplitHtmlAtSelection(event.currentTarget);
                if (!split) return;

                const beforeItems = block.items.slice(0, itemIndex);
                const afterItems = block.items.slice(itemIndex + 1);
                const currentItem = { ...item, html: split.beforeHtml };
                const newItemId = `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const newItem: MarkdownListItem = {
                  id: newItemId,
                  depth: item.depth,
                  ordered: item.ordered,
                  checked: item.checked,
                  html: split.afterHtml,
                };
                onChange({ ...block, items: [...beforeItems, currentItem] });
                const newBlock: Extract<MarkdownBlock, { type: "list" }> = {
                  id: `list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  type: "list",
                  ordered: item.ordered,
                  start: 1,
                  items: [newItem, ...afterItems],
                };
                insertBlockAfter(newBlock);
                focusBlockAtStart(newBlock.id);
              }

              if (event.key === "Tab") {
                event.preventDefault();
                onChange(event.shiftKey ? outdentListItem(block, itemIndex) : indentListItem(block, itemIndex));
              }

              if (event.key === "ArrowLeft" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                if (itemIndex === 0 && isCaretAtStart(event.currentTarget)) {
                  event.preventDefault();
                  onNavigatePrev();
                }
              }

              if (event.key === "ArrowRight" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                if (itemIndex === block.items.length - 1 && isCaretAtEnd(event.currentTarget)) {
                  event.preventDefault();
                  onNavigateNext();
                }
              }

              if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                if (itemIndex === 0 && isCaretAtFirstLine(event.currentTarget)) {
                  event.preventDefault();
                  if (isCaretAtStart(event.currentTarget)) {
                    onNavigatePrev();
                  } else {
                    const node = event.currentTarget;
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    range.collapse(true);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                  }
                }
              }

              if (event.key === "ArrowDown" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                if (itemIndex === block.items.length - 1 && isCaretAtLastLine(event.currentTarget)) {
                  event.preventDefault();
                  if (isCaretAtEnd(event.currentTarget)) {
                    onNavigateNext();
                  } else {
                    const node = event.currentTarget;
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    range.collapse(false);
                    window.getSelection()?.removeAllRanges();
                    window.getSelection()?.addRange(range);
                  }
                }
              }

              if (event.key === "Backspace") {
                if ((event.currentTarget.textContent ?? "") === "") {
                  if (item.depth > 0) {
                    event.preventDefault();
                    onChange(outdentListItem(block, itemIndex));
                    return;
                  }
                  event.preventDefault();
                  removeBlock();
                  return;
                }
                if (itemIndex === 0 && isCaretAtStart(event.currentTarget)) {
                  if (item.depth > 0) {
                    event.preventDefault();
                    onChange(outdentListItem(block, itemIndex));
                    return;
                  }
                  if (onMergeWithPrevious) {
                    event.preventDefault();
                    onMergeWithPrevious();
                  }
                }
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}
