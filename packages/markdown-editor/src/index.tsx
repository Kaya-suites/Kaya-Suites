"use client";

import {
  type DragEvent,
  type FocusEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  createDefaultBlock,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  moveBlock,
  normalizeBlockHtml,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  splitTextBlock,
  type MarkdownBlock,
} from "@kaya/markdown-model";
import { NodeHtmlMarkdown } from "node-html-markdown";
import {
  Bold,
  CheckSquare,
  Code,
  Eye,
  FileCode,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Pencil,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";
import { MarkdownContent } from "./markdown/MarkdownContent";
import { SLASH_COMMANDS } from "./constants";
import { EditorContextProvider } from "./EditorContext";
import { isAllowedLinkHref } from "./sanitize";
import { normalizeClipboardHtml } from "./utils/clipboard";
import {
  canFocusBlock,
  getClosestAnchor,
  getTextBlockHtml,
  isEmptyBlock,
  logMarkdownSegments,
  shouldSplitPasteIntoBlocks,
  uploadImageFile,
} from "./utils/helpers";
import { BlockShell } from "./BlockShell";
import { renderEditorBlock } from "./BlockRenderer";
import { Dialog, ToolbarButton, icon } from "./shared-ui";
import type { DropIndicatorState, ImageDialogState, LinkDialogState, SlashState } from "./types";

const DEBUG_EDITOR = process.env.NEXT_PUBLIC_DEBUG_EDITOR === "1";
const debugLog = (...args: unknown[]) => { if (DEBUG_EDITOR) console.log(...args); };
const URL_REGEX = /^https?:\/\/\S+$/;

type Props = {
  markdown: string;
  onChange: (value: string) => void;
};

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
      <option value="callout">Callout</option>
      <option value="toggle">Toggle</option>
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
  const [slashHoverIndex, setSlashHoverIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set());
  const [dragSelectActive, setDragSelectActive] = useState(false);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [stickyTopOffset, setStickyTopOffset] = useState(0);
  const undoStackRef = useRef<MarkdownBlock[][]>([]);
  const redoStackRef = useRef<MarkdownBlock[][]>([]);
  const composingRef = useRef(false);
  const textEditSnapshotTimerRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dragSelectStartIndexRef = useRef<number | null>(null);
  const lassoOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragSelectAnchorIndexRef = useRef<number | null>(null);
  const dragJustOccurredRef = useRef(false);
  const dragSelectActiveRef = useRef(false);
  const lastEmittedRef = useRef(markdown);
  const editableRefs = useRef(new Map<string, HTMLDivElement>());
  const caretXRef = useRef<number | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectedBlockIdsRef = useRef<Set<string>>(new Set());
  const blocksRef = useRef(blocks);
  const activeBlockIdRef = useRef<string | null>(null);
  const slashStateRef = useRef<SlashState | null>(null);
  const slashHoverIndexRef = useRef(0);
  blocksRef.current = blocks;
  selectedBlockIdsRef.current = selectedBlockIds;
  dragSelectActiveRef.current = dragSelectActive;
  activeBlockIdRef.current = activeBlockId;
  slashStateRef.current = slashState;
  slashHoverIndexRef.current = slashHoverIndex;

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
    if (!slashState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlashMenuPos(null);
      return;
    }
    let node: HTMLElement | null = editableRefs.current.get(slashState.blockId) ?? null;
    if (slashState.itemId) {
      node = document.querySelector<HTMLElement>(`[data-block-id="${slashState.blockId}"][data-item-id="${slashState.itemId}"]`);
    }
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const left = Math.max(8, rect.left);
    setSlashMenuPos(
      spaceBelow >= spaceAbove
        ? { top: rect.bottom + 8, left }
        : { bottom: window.innerHeight - rect.top + 8, left },
    );
  }, [slashState]);

  useLayoutEffect(() => {
    const node = toolbarRef.current;
    if (!node) return;

    const updateOffset = () => {
      setStickyTopOffset(Math.ceil(node.getBoundingClientRect().height));
    };

    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSlashHoverIndex(0); }, [slashState?.query, slashState?.blockId]);

  useEffect(() => {
    if (!blockMenuOpen) return;
    function handleGlobalClick() { setBlockMenuOpen(null); }
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, [blockMenuOpen]);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, blocksRef.current];
    setCanUndo(undoStackRef.current.length > 0);
    setBlocks(snapshot);
  }, []);

  const redo = useCallback(() => {
    const r = redoStackRef.current;
    if (r.length === 0) return;
    const snapshot = r[r.length - 1];
    redoStackRef.current = r.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, blocksRef.current];
    setCanUndo(true);
    setBlocks(snapshot);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: Event) {
      const ke = e as globalThis.KeyboardEvent;
      // Case-insensitive so Shift+Z (which fires as "Z") still hits the redo branch.
      if (!(ke.ctrlKey || ke.metaKey) || ke.key.toLowerCase() !== "z") return;
      if (!editorRef.current?.contains(document.activeElement)) return;
      ke.preventDefault();
      if (ke.shiftKey) redo();
      else undo();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    function handleKeyDown(e: Event) {
      const ke = e as globalThis.KeyboardEvent;
      if (!editorRef.current?.contains(document.activeElement)) return;
      const mod = ke.ctrlKey || ke.metaKey;
      const activeId = activeBlockIdRef.current;
      const activeEl = document.activeElement as HTMLElement | null;

      const slash = slashStateRef.current;
      if (slash) {
        const matches = SLASH_COMMANDS.filter((c) =>
          c.label.toLowerCase().includes(slash.query) || c.description.toLowerCase().includes(slash.query),
        );
        if (ke.key === "Escape") { ke.preventDefault(); setSlashState(null); return; }
        if (ke.key === "ArrowDown" && matches.length > 0) {
          ke.preventDefault();
          setSlashHoverIndex((i) => Math.min(i + 1, matches.length - 1));
          return;
        }
        if (ke.key === "ArrowUp" && matches.length > 0) {
          ke.preventDefault();
          setSlashHoverIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (ke.key === "Enter" && matches.length > 0) {
          ke.preventDefault();
          const idx = Math.min(slashHoverIndexRef.current, matches.length - 1);
          applySlashCommand(matches[idx]);
          return;
        }
      }

      if (mod && !ke.shiftKey && !ke.altKey && activeEl?.isContentEditable) {
        if (ke.key === "b") { ke.preventDefault(); document.execCommand("bold"); return; }
        if (ke.key === "i") { ke.preventDefault(); document.execCommand("italic"); return; }
        if (ke.key === "u") { ke.preventDefault(); document.execCommand("underline"); return; }
        if (ke.key === "k" && activeId) {
          ke.preventDefault();
          rememberSelection(activeId);
          const node = editableRefs.current.get(activeId);
          const sel = window.getSelection();
          const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
          const anchor = range ? getClosestAnchor(range.commonAncestorContainer) : null;
          if (node && (range || selectionRangeRef.current)) {
            setLinkDialog({
              blockId: activeId,
              href: anchor?.getAttribute("href") ?? "",
              open: true,
              anchor,
              range: range?.cloneRange() ?? selectionRangeRef.current?.cloneRange() ?? null,
            });
          }
          return;
        }
      }

      if (mod && (ke.key === "ArrowUp" || ke.key === "ArrowDown") && !ke.altKey && !ke.shiftKey) {
        const all = blocksRef.current;
        if (all.length === 0) return;
        const target = ke.key === "ArrowUp" ? all[0] : all[all.length - 1];
        ke.preventDefault();
        if (ke.key === "ArrowUp") focusBlockAtStart(target.id);
        else focusBlockAtEnd(target.id);
        return;
      }

      if (ke.altKey && ke.shiftKey && (ke.key === "ArrowUp" || ke.key === "ArrowDown")) {
        if (!activeId) return;
        ke.preventDefault();
        setBlocks((current) => {
          const idx = current.findIndex((b) => b.id === activeId);
          if (idx === -1) return current;
          const target = ke.key === "ArrowUp" ? idx - 1 : idx + 1;
          if (target < 0 || target >= current.length) return current;
          pushHistory(current);
          return moveBlock(current, idx, target);
        });
        return;
      }

      if ((ke.ctrlKey || ke.metaKey) && ke.key === "a") {
        const el = document.activeElement as HTMLElement | null;
        if (el?.isContentEditable) {
          const sel = window.getSelection();
          const blockText = el.textContent ?? "";
          const selectedText = sel?.toString() ?? "";
          if (blockText.length > 0 && selectedText !== blockText) {
            return; // let the browser select block contents first
          }
        }
        ke.preventDefault();
        setSelectedBlockIds(new Set(blocksRef.current.map((b) => b.id)));
        return;
      }

      if ((ke.ctrlKey || ke.metaKey) && ke.key === "c" && selectedBlockIdsRef.current.size > 0) {
        const sel = selectedBlockIdsRef.current;
        const md = serializeBlocksToMarkdown(blocksRef.current.filter((b) => sel.has(b.id)));
        void navigator.clipboard.writeText(md);
        return;
      }

      if ((ke.ctrlKey || ke.metaKey) && ke.key === "x" && selectedBlockIdsRef.current.size > 0) {
        ke.preventDefault();
        const sel = selectedBlockIdsRef.current;
        const md = serializeBlocksToMarkdown(blocksRef.current.filter((b) => sel.has(b.id)));
        void navigator.clipboard.writeText(md);
        setSelectedBlockIds(new Set());
        setBlocks((current) => {
          pushHistory(current);
          const next = current.filter((b) => !sel.has(b.id));
          return next.length > 0 ? next : [createDefaultBlock("paragraph")];
        });
        return;
      }

      if ((ke.key === "Backspace" || ke.key === "Delete") && selectedBlockIdsRef.current.size > 0) {
        ke.preventDefault();
        const sel = selectedBlockIdsRef.current;
        setSelectedBlockIds(new Set());
        setBlocks((current) => {
          pushHistory(current);
          const next = current.filter((b) => !sel.has(b.id));
          return next.length > 0 ? next : [createDefaultBlock("paragraph")];
        });
        return;
      }

      if (ke.key === "Escape" && activeEl?.isContentEditable && activeId) {
        ke.preventDefault();
        activeEl.blur();
        setSelectedBlockIds(new Set([activeId]));
        setActiveBlockId(null);
        editorRef.current?.focus();
        return;
      }

      if (
        selectedBlockIdsRef.current.size === 1 &&
        !activeId &&
        !mod &&
        !ke.altKey &&
        !ke.shiftKey
      ) {
        const sid = Array.from(selectedBlockIdsRef.current)[0];
        const all = blocksRef.current;
        const idx = all.findIndex((b) => b.id === sid);
        if (ke.key === "ArrowUp" || ke.key === "ArrowDown") {
          ke.preventDefault();
          if (idx === -1) return;
          const target = ke.key === "ArrowUp" ? idx - 1 : idx + 1;
          if (target < 0 || target >= all.length) return;
          setSelectedBlockIds(new Set([all[target].id]));
          return;
        }
        if (ke.key === "Enter") {
          ke.preventDefault();
          if (idx === -1) return;
          setSelectedBlockIds(new Set());
          setActiveBlockId(sid);
          window.requestAnimationFrame(() => editableRefs.current.get(sid)?.focus());
          return;
        }
      }

      if (ke.key === "Escape" && selectedBlockIdsRef.current.size > 0) {
        setSelectedBlockIds(new Set());
        return;
      }

      if (selectedBlockIdsRef.current.size > 0 && !ke.ctrlKey && !ke.metaKey && !ke.altKey && ke.key !== "ArrowUp" && ke.key !== "ArrowDown" && ke.key !== "ArrowLeft" && ke.key !== "ArrowRight") {
        setSelectedBlockIds(new Set());
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!draggingBlockId) return;
    let raf = 0;
    let velocity = 0;
    function tick() {
      const scroller = editorRef.current?.querySelector<HTMLDivElement>("[data-editor-scroll]");
      if (scroller && velocity !== 0) {
        scroller.scrollTop += velocity;
      }
      raf = window.requestAnimationFrame(tick);
    }
    function onDragOver(e: globalThis.DragEvent) {
      const scroller = editorRef.current?.querySelector<HTMLDivElement>("[data-editor-scroll]");
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      const margin = 60;
      if (e.clientY < rect.top + margin) velocity = -Math.max(4, (rect.top + margin - e.clientY) / 6);
      else if (e.clientY > rect.bottom - margin) velocity = Math.max(4, (e.clientY - (rect.bottom - margin)) / 6);
      else velocity = 0;
    }
    document.addEventListener("dragover", onDragOver);
    raf = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      window.cancelAnimationFrame(raf);
      velocity = 0;
    };
  }, [draggingBlockId]);

  useEffect(() => {
    if (selectedBlockIds.size > 0 && activeBlockId === null) {
      if (editorRef.current && !editorRef.current.contains(document.activeElement)) {
        editorRef.current.focus();
      }
    }
  }, [selectedBlockIds, activeBlockId]);

  useEffect(() => {
    function handleMouseUp() {
      lassoOriginRef.current = null;
      setLassoRect(null);
      setDragSelectActive(false);
      document.body.style.userSelect = "";
      requestAnimationFrame(() => { dragJustOccurredRef.current = false; });
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const origin = lassoOriginRef.current;
      if (!origin) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.sqrt(dx * dx + dy * dy) < 5) return;

      if (!dragSelectActiveRef.current) {
        setDragSelectActive(true);
        dragJustOccurredRef.current = true;
        setActiveBlockId(null);
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
      }

      const x = Math.min(origin.x, e.clientX);
      const y = Math.min(origin.y, e.clientY);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      setLassoRect({ x, y, w, h });

      const editor = editorRef.current;
      if (!editor) return;
      const blockEls = editor.querySelectorAll<HTMLElement>("[data-block-id]");
      const selected = new Set<string>();
      blockEls.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) {
          selected.add(el.dataset.blockId!);
        }
      });
      setSelectedBlockIds(selected);
    }
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  function pushHistory(current: MarkdownBlock[]) {
    undoStackRef.current = [...undoStackRef.current.slice(-49), current];
    redoStackRef.current = [];
    if (textEditSnapshotTimerRef.current !== null) {
      window.clearTimeout(textEditSnapshotTimerRef.current);
      textEditSnapshotTimerRef.current = null;
    }
    setCanUndo(true);
  }

  // F19 / B5: every structural mutation goes through applyBlocks so a history
  // snapshot is captured atomically with the state change. setBlocks is reserved
  // for non-mutating replacements (markdown prop sync, undo/redo target state).
  function applyBlocks(updater: (current: MarkdownBlock[]) => MarkdownBlock[]) {
    setBlocks((current) => {
      const next = updater(current);
      if (next === current) return current;
      pushHistory(current);
      return next;
    });
  }

  function scheduleTextEditSnapshot() {
    if (textEditSnapshotTimerRef.current !== null) return;
    const snapshot = blocksRef.current;
    textEditSnapshotTimerRef.current = window.setTimeout(() => {
      textEditSnapshotTimerRef.current = null;
      const current = blocksRef.current;
      if (current === snapshot) return;
      undoStackRef.current = [...undoStackRef.current.slice(-49), snapshot];
      redoStackRef.current = [];
      setCanUndo(true);
    }, 800);
  }

  function updateBlock(blockId: string, updater: (block: MarkdownBlock) => MarkdownBlock) {
    scheduleTextEditSnapshot();
    setBlocks((current) =>
      current.map((block) => (block.id === blockId ? normalizeBlockHtml(updater(block)) : block)),
    );
  }

  function insertBlockAfter(blockId: string, block: MarkdownBlock) {
    applyBlocks((current) => {
      const index = current.findIndex((item) => item.id === blockId);
      if (index === -1) return [...current, block];
      const next = [...current];
      next.splice(index + 1, 0, block);
      return next;
    });
    setActiveBlockId(block.id);
  }

  function replaceBlock(blockId: string, nextBlock: MarkdownBlock) {
    applyBlocks((current) => current.map((block) => (block.id === blockId ? nextBlock : block)));
    setActiveBlockId(nextBlock.id);
  }

  function splitEditableTextBlock(blockId: string, split: { beforeHtml: string; afterHtml: string }) {
    const block = blocks.find((item) => item.id === blockId);
    if (!block || (block.type !== "paragraph" && block.type !== "blockquote" && block.type !== "heading")) {
      return;
    }

    const { current: currentBlock, next } = splitTextBlock(block, split.beforeHtml, split.afterHtml);
    const normalizedCurrent = normalizeBlockHtml(currentBlock);
    const normalizedNext = normalizeBlockHtml(next);

    flushSync(() => {
      applyBlocks((current) => {
        const index = current.findIndex((item) => item.id === blockId);
        if (index === -1) return current;
        const nextBlocks = [...current];
        nextBlocks.splice(index, 1, normalizedCurrent, normalizedNext);
        return nextBlocks;
      });

      setActiveBlockId(normalizedNext.id);
    });

    focusEditableAtStart(normalizedNext.id);
  }

  function removeBlock(blockId: string) {
    applyBlocks((current) => {
      if (current.length === 1) return [createDefaultBlock("paragraph")];
      return current.filter((block) => block.id !== blockId);
    });
  }

  function focusEditable(blockId: string, attempt = 0) {
    window.requestAnimationFrame(() => {
      const node = editableRefs.current.get(blockId);
      if (node) {
        node.focus();
        return;
      }
      if (attempt < 2) {
        focusEditable(blockId, attempt + 1);
      }
    });
  }

  function focusEditableBoundary(blockId: string, collapseToStart: boolean, attempt = 0) {
    const node = editableRefs.current.get(blockId);
    if (!node) {
      if (attempt < 2) {
        window.requestAnimationFrame(() => focusEditableBoundary(blockId, collapseToStart, attempt + 1));
      }
      return;
    }
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(collapseToStart);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    selectionRangeRef.current = range.cloneRange();
  }

  function focusEditableAtStart(blockId: string) {
    focusEditableBoundary(blockId, true);
  }

  function focusEditableAtEnd(blockId: string) {
    focusEditableBoundary(blockId, false);
  }

  function focusBlockAtStart(blockId: string) {
    if (editableRefs.current.has(blockId)) {
      focusEditableAtStart(blockId);
      return;
    }
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"][contenteditable="true"]`);
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else {
        setActiveBlockId(blockId);
      }
    });
  }

  function focusAtTextOffset(el: HTMLElement, textOffset: number) {
    el.focus();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = textOffset;
    let found: { node: Text; offset: number } | null = null;
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const len = textNode.textContent?.length ?? 0;
      if (remaining <= len) {
        found = { node: textNode, offset: remaining };
        break;
      }
      remaining -= len;
    }
    const range = document.createRange();
    if (found) {
      range.setStart(found.node, found.offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    selectionRangeRef.current = range.cloneRange();
  }

  function focusBlockAtEnd(blockId: string) {
    if (editableRefs.current.has(blockId)) {
      focusEditableAtEnd(blockId);
      return;
    }
    window.requestAnimationFrame(() => {
      const els = document.querySelectorAll<HTMLElement>(`[data-block-id="${blockId}"][contenteditable="true"]`);
      const el = els.length > 0 ? els[els.length - 1] : null;
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else {
        setActiveBlockId(blockId);
      }
    });
  }

  function mergeBlockWithPrevious(blockId: string) {
    const current = blocksRef.current;
    const index = current.findIndex((b) => b.id === blockId);
    if (index <= 0) return;
    const curBlock = current[index];
    const prevBlock = current[index - 1];
    if (curBlock.type !== "paragraph" && curBlock.type !== "blockquote" && curBlock.type !== "heading") return;

    if ((curBlock.type === "heading" || curBlock.type === "blockquote") && inlineHtmlToMarkdown(curBlock.html).trim() === "") {
      replaceBlock(curBlock.id, { id: curBlock.id, type: "paragraph", html: "", depth: 0 });
      focusEditableAtStart(curBlock.id);
      return;
    }
    if (curBlock.type === "paragraph" && curBlock.depth > 0 && inlineHtmlToMarkdown(curBlock.html).trim() === "") {
      replaceBlock(curBlock.id, { ...curBlock, depth: 0 });
      focusEditableAtStart(curBlock.id);
      return;
    }

    if (prevBlock.type === "paragraph" || prevBlock.type === "blockquote" || prevBlock.type === "heading") {
      const temp = document.createElement("div");
      temp.innerHTML = prevBlock.html;
      const junctionOffset = temp.textContent?.length ?? 0;
      // B7: flushSync forces the merge to commit before the rAF below reads the
      // post-merge DOM, so junctionOffset can't drift on rapid consecutive merges.
      flushSync(() => {
        applyBlocks((state) => {
          const idx = state.findIndex((b) => b.id === blockId);
          if (idx <= 0) return state;
          const p = state[idx - 1];
          const c = state[idx];
          if ((p.type !== "paragraph" && p.type !== "blockquote" && p.type !== "heading") ||
              (c.type !== "paragraph" && c.type !== "blockquote" && c.type !== "heading")) return state;
          const next = [...state];
          next[idx - 1] = normalizeBlockHtml({ ...p, html: p.html + c.html });
          next.splice(idx, 1);
          return next;
        });
        setActiveBlockId(prevBlock.id);
      });
      window.requestAnimationFrame(() => {
        const el = editableRefs.current.get(prevBlock.id);
        if (el) focusAtTextOffset(el, junctionOffset);
      });
      return;
    }

    if (prevBlock.type === "list") {
      const lastItem = prevBlock.items[prevBlock.items.length - 1];
      if (!lastItem) return;
      const temp = document.createElement("div");
      temp.innerHTML = lastItem.html;
      const junctionOffset = temp.textContent?.length ?? 0;
      const targetBlockId = prevBlock.id;
      const targetItemId = lastItem.id;
      flushSync(() => {
        applyBlocks((state) => {
          const idx = state.findIndex((b) => b.id === blockId);
          if (idx <= 0) return state;
          const p = state[idx - 1];
          const c = state[idx];
          if (p.type !== "list" || (c.type !== "paragraph" && c.type !== "blockquote" && c.type !== "heading")) return state;
          const next = [...state];
          next[idx - 1] = { ...p, items: p.items.map((item, i) => i === p.items.length - 1 ? { ...item, html: item.html + c.html } : item) };
          next.splice(idx, 1);
          return next;
        });
        setActiveBlockId(targetBlockId);
      });
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${targetBlockId}"][data-item-id="${targetItemId}"][contenteditable="true"]`);
        if (el) focusAtTextOffset(el, junctionOffset);
      });
      return;
    }

    if (prevBlock.type === "table" || prevBlock.type === "image" || prevBlock.type === "hr" || prevBlock.type === "html") {
      setActiveBlockId(prevBlock.id);
    }
    // code: do nothing
  }

  function mergeListItemWithPrevious(listBlockId: string) {
    const current = blocksRef.current;
    const index = current.findIndex((b) => b.id === listBlockId);
    if (index <= 0) return;
    const listBlock = current[index];
    const prevBlock = current[index - 1];
    if (listBlock.type !== "list") return;
    const firstItem = listBlock.items[0];
    if (!firstItem) return;

    if (prevBlock.type === "paragraph" || prevBlock.type === "blockquote" || prevBlock.type === "heading") {
      const temp = document.createElement("div");
      temp.innerHTML = prevBlock.html;
      const junctionOffset = temp.textContent?.length ?? 0;
      flushSync(() => {
        applyBlocks((state) => {
          const idx = state.findIndex((b) => b.id === listBlockId);
          if (idx <= 0) return state;
          const p = state[idx - 1];
          const l = state[idx];
          if ((p.type !== "paragraph" && p.type !== "blockquote" && p.type !== "heading") || l.type !== "list") return state;
          const item = l.items[0];
          if (!item) return state;
          const next = [...state];
          next[idx - 1] = normalizeBlockHtml({ ...p, html: p.html + item.html });
          const remaining = l.items.slice(1);
          if (remaining.length === 0) next.splice(idx, 1);
          else next[idx] = { ...l, items: remaining };
          return next;
        });
        setActiveBlockId(prevBlock.id);
      });
      window.requestAnimationFrame(() => {
        const el = editableRefs.current.get(prevBlock.id);
        if (el) focusAtTextOffset(el, junctionOffset);
      });
      return;
    }

    if (prevBlock.type === "list") {
      const lastItem = prevBlock.items[prevBlock.items.length - 1];
      if (!lastItem) return;
      const temp = document.createElement("div");
      temp.innerHTML = lastItem.html;
      const junctionOffset = temp.textContent?.length ?? 0;
      const targetBlockId = prevBlock.id;
      const targetItemId = lastItem.id;
      flushSync(() => {
        applyBlocks((state) => {
          const idx = state.findIndex((b) => b.id === listBlockId);
          if (idx <= 0) return state;
          const p = state[idx - 1];
          const l = state[idx];
          if (p.type !== "list" || l.type !== "list") return state;
          const item = l.items[0];
          if (!item) return state;
          const next = [...state];
          next[idx - 1] = { ...p, items: p.items.map((pi, i) => i === p.items.length - 1 ? { ...pi, html: pi.html + item.html } : pi) };
          const remaining = l.items.slice(1);
          if (remaining.length === 0) next.splice(idx, 1);
          else next[idx] = { ...l, items: remaining };
          return next;
        });
        setActiveBlockId(targetBlockId);
      });
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-block-id="${targetBlockId}"][data-item-id="${targetItemId}"][contenteditable="true"]`);
        if (el) focusAtTextOffset(el, junctionOffset);
      });
      return;
    }

    if (prevBlock.type === "table" || prevBlock.type === "image" || prevBlock.type === "hr" || prevBlock.type === "html") {
      setActiveBlockId(prevBlock.id);
    }
    // code: do nothing
  }

  function syncEditableBlock(blockId: string) {
    const node = editableRefs.current.get(blockId);
    if (!node) return;
    scheduleTextEditSnapshot();
    updateBlock(blockId, (block) => {
      if (block.type === "paragraph" || block.type === "blockquote" || block.type === "heading") {
        return { ...block, html: node.innerHTML };
      }
      return block;
    });
  }

  function syncEditableTarget(target: HTMLElement | null) {
    const blockId = target?.dataset.blockId;
    if (!target || !blockId) return;

    const itemId = target.dataset.itemId;
    if (itemId) {
      updateBlock(blockId, (block) => {
        if (block.type !== "list") return block;
        return {
          ...block,
          items: block.items.map((item) => (item.id === itemId ? { ...item, html: target.innerHTML } : item)),
        };
      });
      setActiveBlockId(blockId);
      rememberSelection(blockId);
      return;
    }

    syncEditableBlock(blockId);
    setActiveBlockId(blockId);
    rememberSelection(blockId);
  }

  function rememberSelection(blockId = activeBlockId) {
    if (!blockId) return;
    const node = editableRefs.current.get(blockId);
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;
    if (range.collapsed && selectionRangeRef.current && !selectionRangeRef.current.collapsed) return;
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

  function getLinkDialogRange(blockId: string) {
    const node = editableRefs.current.get(blockId);
    const selection = window.getSelection();
    if (node && selection && selection.rangeCount > 0) {
      const currentRange = selection.getRangeAt(0);
      if (node.contains(currentRange.commonAncestorContainer)) {
        if (!currentRange.collapsed || getClosestAnchor(currentRange.commonAncestorContainer)) {
          return currentRange.cloneRange();
        }
      }
    }

    const savedRange = selectionRangeRef.current;
    if (node && savedRange && node.contains(savedRange.commonAncestorContainer)) {
      return savedRange.cloneRange();
    }

    return null;
  }

  function applyLinkToRange(blockId: string, range: Range, href: string) {
    const node = editableRefs.current.get(blockId);
    if (!node || !node.contains(range.commonAncestorContainer)) return null;

    node.focus();

    const selection = window.getSelection();
    const workingRange = range.cloneRange();
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);

    if (workingRange.collapsed) {
      anchor.textContent = href;
      workingRange.insertNode(anchor);
    } else {
      anchor.appendChild(workingRange.extractContents());
      workingRange.insertNode(anchor);
    }

    const nextRange = document.createRange();
    nextRange.selectNodeContents(anchor);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    selectionRangeRef.current = nextRange.cloneRange();

    syncEditableBlock(blockId);
    return anchor;
  }

  function updateActiveBlockType(value: string) {
    if (!activeBlock) return;
    const depth = 'depth' in activeBlock ? activeBlock.depth : 0;

    if (value.startsWith("heading-")) {
      const level = Number.parseInt(value.split("-")[1] ?? "2", 10) as 1 | 2 | 3;
      const html = getTextBlockHtml(activeBlock);
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "heading", level, html, depth });
      focusEditable(activeBlock.id);
      return;
    }

    if (value === "paragraph") {
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "paragraph", html: getTextBlockHtml(activeBlock), depth });
      focusEditable(activeBlock.id);
      return;
    }

    if (value === "blockquote") {
      replaceBlock(activeBlock.id, { id: activeBlock.id, type: "blockquote", html: getTextBlockHtml(activeBlock), depth });
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
            ordered: value === "list-numbered",
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

  function applySlashCommand(command: (typeof SLASH_COMMANDS)[number]) {
    if (!slashState) return;
    const nextBlock = command.build();
    const { blockId, itemId } = slashState;

    if (itemId) {
      setBlocks((current) => {
        const idx = current.findIndex((b) => b.id === blockId);
        if (idx === -1) return current;
        const target = current[idx];
        if (target.type !== "list") return current;
        pushHistory(current);
        const remainingItems = target.items.filter((it) => it.id !== itemId);
        const next = [...current];
        if (remainingItems.length === 0) {
          next.splice(idx, 1, nextBlock);
        } else {
          next.splice(idx, 1, { ...target, items: remainingItems }, nextBlock);
        }
        return next;
      });
      setActiveBlockId(nextBlock.id);
      setSlashState(null);
      if (nextBlock.type === "paragraph" || nextBlock.type === "heading" || nextBlock.type === "blockquote") {
        window.requestAnimationFrame(() => editableRefs.current.get(nextBlock.id)?.focus());
      }
      return;
    }

    replaceBlock(blockId, nextBlock);
    setSlashState(null);
    if (nextBlock.type === "paragraph" || nextBlock.type === "heading" || nextBlock.type === "blockquote") {
      focusEditable(nextBlock.id);
    }
  }

  function openLinkDialog() {
    if (!activeBlockId) return;
    rememberSelection(activeBlockId);

    const range = getLinkDialogRange(activeBlockId);
    const anchor = range ? getClosestAnchor(range.commonAncestorContainer) : null;
    const href = anchor?.getAttribute("href") ?? "";

    setLinkDialog({ blockId: activeBlockId, href, open: true, anchor, range });
  }

  function saveLink() {
    if (!linkDialog) return;
    const href = linkDialog.href.trim();
    if (!href) return;
    // B22: block javascript:, data:, and other dangerous schemes. Allow only
    // http(s), mailto, fragment, and root-relative paths.
    if (!isAllowedLinkHref(href)) {
      setLinkDialog(null);
      return;
    }

    if (linkDialog.anchor) {
      linkDialog.anchor.setAttribute("href", href);
      syncEditableBlock(linkDialog.blockId);
    } else {
      const range = linkDialog.range ?? selectionRangeRef.current;
      if (!range) return;
      applyLinkToRange(linkDialog.blockId, range, href);
    }
    setLinkDialog(null);
  }

  function removeLink() {
    if (!linkDialog?.anchor) return;
    const anchor = linkDialog.anchor;
    const parent = anchor.parentNode;
    if (parent) {
      while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
      parent.removeChild(anchor);
    }
    syncEditableBlock(linkDialog.blockId);
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
    const html = event.clipboardData.getData("text/html").trim();
    const text = event.clipboardData.getData("text/plain");
    debugLog("[KayaMarkdownEditor] paste", {
      activeBlockId,
      target: event.target instanceof HTMLElement ? event.target.tagName : null,
      text,
      html,
      files: Array.from(event.clipboardData.files).map((item) => ({
        name: item.name,
        type: item.type,
        size: item.size,
      })),
    });

    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (file) {
      debugLog("[KayaMarkdownEditor] paste branch=image-file", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      event.preventDefault();
      void insertImageFromFile(file);
      return;
    }

    if (activeBlockId && URL_REGEX.test(text.trim())) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const node = editableRefs.current.get(activeBlockId);
        const range = sel.getRangeAt(0);
        if (node && node.contains(range.commonAncestorContainer)) {
          event.preventDefault();
          applyLinkToRange(activeBlockId, range, text.trim());
          return;
        }
      }
    }

    const normalizedHtml = html ? normalizeClipboardHtml(html) : "";
    const htmlMarkdown = normalizedHtml
      ? NodeHtmlMarkdown.translate(normalizedHtml, { preferNativeParser: true, bulletMarker: "-", indent: "  " })
      : "";
    const htmlParsedBlocks = htmlMarkdown.trim()
      ? parseMarkdownToBlocks(htmlMarkdown).map((block) => normalizeBlockHtml(block))
      : [];
    const htmlMarkdownSegments = htmlMarkdown
      ? htmlMarkdown
          .split(/(\n+)/)
          .filter((segment) => segment.length > 0)
          .map((segment): { kind: "newline" | "content"; value: string } => ({
            kind: /^\n+$/.test(segment) ? "newline" : "content",
            value: segment,
          }))
      : [];

    if (html) {
      debugLog("[KayaMarkdownEditor] paste html->markdown", {
        html,
        normalizedHtml,
        markdown: htmlMarkdown,
        blockCount: htmlParsedBlocks.length,
        blockTypes: htmlParsedBlocks.map((block) => block.type),
      });
      if (DEBUG_EDITOR) logMarkdownSegments("[KayaMarkdownEditor] paste html->markdown segment", htmlMarkdownSegments);
    }

    if (htmlParsedBlocks.length > 0) {
      debugLog("[KayaMarkdownEditor] paste branch=html-markdown-blocks", {
        blockCount: htmlParsedBlocks.length,
        blockTypes: htmlParsedBlocks.map((block) => block.type),
        markdown: htmlMarkdown,
      });
      if (DEBUG_EDITOR) logMarkdownSegments("[KayaMarkdownEditor] paste branch=html-markdown-blocks segment", htmlMarkdownSegments);
      event.preventDefault();

      const nextActiveBlock = htmlParsedBlocks[0];

      setBlocks((current) => {
        pushHistory(current);
        if (current.length === 0) return htmlParsedBlocks;

        const sel = selectedBlockIdsRef.current;
        let lastSelIdx = -1;
        if (!activeBlockId && sel.size > 0) {
          current.forEach((b, i) => { if (sel.has(b.id)) lastSelIdx = i; });
        }
        const activeIndex = activeBlockId
          ? current.findIndex((block) => block.id === activeBlockId)
          : lastSelIdx >= 0 ? lastSelIdx : current.length - 1;
        if (activeIndex === -1) return [...current, ...htmlParsedBlocks];

        const next = [...current];
        const activeBlock = next[activeIndex];

        if (activeBlock && isEmptyBlock(activeBlock)) {
          next.splice(activeIndex, 1, ...htmlParsedBlocks);
          return next;
        }

        next.splice(activeIndex + 1, 0, ...htmlParsedBlocks);
        return next;
      });

      setActiveBlockId(nextActiveBlock.id);
      if (canFocusBlock(nextActiveBlock)) {
        focusEditable(nextActiveBlock.id);
      }
      return;
    }

    if (!text.trim()) {
      debugLog("[KayaMarkdownEditor] paste branch=empty-text");
      return;
    }

    const parsedBlocks = parseMarkdownToBlocks(text).map((block) => normalizeBlockHtml(block));
    if (!shouldSplitPasteIntoBlocks(text, parsedBlocks)) {
      debugLog("[KayaMarkdownEditor] paste branch=plain-text-inline", {
        text,
      });
      return;
    }

    debugLog("[KayaMarkdownEditor] paste branch=plain-text-blocks", {
      text,
      blockCount: parsedBlocks.length,
      blockTypes: parsedBlocks.map((block) => block.type),
    });

    event.preventDefault();

    const nextActiveBlock = parsedBlocks[0];

    setBlocks((current) => {
      pushHistory(current);
      if (current.length === 0) return parsedBlocks;

      const sel = selectedBlockIdsRef.current;
      let lastSelIdx = -1;
      if (!activeBlockId && sel.size > 0) {
        current.forEach((b, i) => { if (sel.has(b.id)) lastSelIdx = i; });
      }
      const activeIndex = activeBlockId
        ? current.findIndex((block) => block.id === activeBlockId)
        : lastSelIdx >= 0 ? lastSelIdx : current.length - 1;
      if (activeIndex === -1) return [...current, ...parsedBlocks];

      const next = [...current];
      const activeBlock = next[activeIndex];

      if (activeBlock && isEmptyBlock(activeBlock)) {
        next.splice(activeIndex, 1, ...parsedBlocks);
        return next;
      }

      next.splice(activeIndex + 1, 0, ...parsedBlocks);
      return next;
    });

    setActiveBlockId(nextActiveBlock.id);
    if (canFocusBlock(nextActiveBlock)) {
      focusEditable(nextActiveBlock.id);
    }
  }

  const filteredCommands = slashState
    ? SLASH_COMMANDS.filter((command) =>
        command.label.toLowerCase().includes(slashState.query) ||
        command.description.toLowerCase().includes(slashState.query),
      )
    : [];

  return (
    <EditorContextProvider composingRef={composingRef} undo={undo} redo={redo} stickyTopOffset={stickyTopOffset}>
    <div
      ref={editorRef}
      tabIndex={-1}
      role="region"
      aria-label="Markdown editor"
      className={`flex h-full min-h-0 flex-col outline-none ${isFullscreen ? "mx-auto w-full max-w-5xl px-8 py-6" : ""}`}
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

      <div ref={toolbarRef} className="sticky top-0 z-20 border-b-2 border-black bg-[var(--color-background)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={
              activeBlock?.type === "heading"
                ? `heading-${activeBlock.level}`
                : activeBlock?.type === "list"
                  ? activeBlock.items.some((item) => item.checked !== null)
                    ? "list-task"
                    : activeBlock.items.some((item) => item.ordered)
                      ? "list-numbered"
                      : "list-bullet"
                  : activeBlock?.type ?? "paragraph"
            }
            onChange={(event) => updateActiveBlockType(event.target.value)}
            className="border-2 border-black bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
          >
            {renderBlockTypeOptions()}
          </select>

          <ToolbarButton title="Undo" icon={<Undo2 size={14} />} onClick={() => {
            const stack = undoStackRef.current;
            if (stack.length === 0) return;
            const snapshot = stack[stack.length - 1];
            undoStackRef.current = stack.slice(0, -1);
            redoStackRef.current = [...redoStackRef.current, blocksRef.current];
            setCanUndo(undoStackRef.current.length > 0);
            setBlocks(snapshot);
          }} disabled={!canUndo} />
          <div className="mx-1 h-7 w-0.5 bg-black" />
          <ToolbarButton title="Bold" icon={<Bold size={14} />} onClick={() => applyInlineCommand("bold")} />
          <ToolbarButton title="Italic" icon={<Italic size={14} />} onClick={() => applyInlineCommand("italic")} />
          <ToolbarButton title="Strikethrough" icon={<Strikethrough size={14} />} onClick={() => applyInlineCommand("strikeThrough")} />
          <ToolbarButton title="Inline Code" icon={<Code size={14} />} onClick={() => applyInlineCommand("insertHTML", `<code>${window.getSelection()?.toString() ?? ""}</code>`)} />
          <ToolbarButton title="Link" icon={<Link size={14} />} onClick={openLinkDialog} />
          <div className="mx-1 h-7 w-0.5 bg-black" />
          <ToolbarButton title="Bulleted List" icon={<List size={14} />} onClick={() => updateActiveBlockType("list-bullet")} />
          <ToolbarButton title="Numbered List" icon={<ListOrdered size={14} />} onClick={() => updateActiveBlockType("list-numbered")} />
          <ToolbarButton title="Task List" icon={<CheckSquare size={14} />} onClick={() => updateActiveBlockType("list-task")} />
          <div className="mx-1 h-7 w-0.5 bg-black" />
          <ToolbarButton title="Insert Table" icon={<Table size={14} />} onClick={() => activeBlockId && insertBlockAfter(activeBlockId, createDefaultBlock("table"))} />
          <ToolbarButton title="Insert Code Block" icon={<FileCode size={14} />} onClick={() => activeBlockId && insertBlockAfter(activeBlockId, createDefaultBlock("code"))} />
          <ToolbarButton
            title="Insert Image"
            icon={<Image size={14} />}
            onClick={() => setImageDialog({ open: true, alt: "", src: "", title: "" })}
          />
          <div className="mx-1 h-7 w-0.5 bg-black" />
          <ToolbarButton title={isReadOnly ? "Switch to Edit" : "Switch to View"} icon={isReadOnly ? <Pencil size={14} /> : <Eye size={14} />} onClick={() => setIsReadOnly((value) => !value)} />
          <ToolbarButton title={isFullscreen ? "Exit Focus" : "Focus Mode"} icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={() => setIsFullscreen((value) => !value)} />
        </div>
      </div>

      {linkDialog?.open && (
        <Dialog title={linkDialog.anchor ? "Edit Link" : "Insert Link"} onClose={() => setLinkDialog(null)}>
          <input
            value={linkDialog.href}
            onChange={(event) => setLinkDialog((current) => (current ? { ...current, href: event.target.value } : current))}
            className="w-full border-2 border-black bg-white px-3 py-2 text-sm font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
            placeholder="https://example.com"
            autoFocus
            onKeyDown={(event) => { if (event.key === "Enter") saveLink(); }}
          />
          <div className="flex items-center gap-2">
            {linkDialog.anchor && (
              <button
                onClick={removeLink}
                className="border-2 border-black px-3 py-1.5 text-xs font-bold uppercase tracking-wide font-mono text-[var(--color-danger)]"
                style={{ borderRadius: "var(--border-radius)" }}
              >
                Remove
              </button>
            )}
            <div className="flex-1" />
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

      <div
        data-editor-scroll
        className="flex-1 overflow-y-auto px-6 py-3"
        onMouseDown={(e) => {
          const blockEl = (e.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
          if (blockEl) {
            const blockId = blockEl.dataset.blockId!;
            const blockIndex = blocksRef.current.findIndex((b) => b.id === blockId);
            if (e.shiftKey) {
              e.preventDefault();
              const anchor = dragSelectAnchorIndexRef.current ?? blockIndex;
              const lo = Math.min(anchor, blockIndex);
              const hi = Math.max(anchor, blockIndex);
              setSelectedBlockIds(new Set(blocksRef.current.slice(lo, hi + 1).map((b) => b.id)));
              setActiveBlockId(null);
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setSelectedBlockIds((prev) => {
                const next = new Set(prev);
                if (next.has(blockId)) next.delete(blockId);
                else next.add(blockId);
                return next;
              });
              dragSelectAnchorIndexRef.current = blockIndex;
              setActiveBlockId(null);
              return;
            }
            lassoOriginRef.current = { x: e.clientX, y: e.clientY };
            dragSelectAnchorIndexRef.current = blockIndex;
          } else {
            if (selectedBlockIdsRef.current.size > 0) setSelectedBlockIds(new Set());
          }
        }}
      >
        {isReadOnly ? (
          <div className="mx-auto w-full max-w-4xl">
            <MarkdownContent markdown={serializeBlocksToMarkdown(blocks)} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-px">
            {blocks.map((block, index) => (
              <BlockShell
                key={block.id}
                block={block}
                index={index}
                active={block.id === activeBlockId}
                selected={selectedBlockIds.has(block.id)}
                onActivate={() => {
                  if (dragJustOccurredRef.current) return;
                  setActiveBlockId(block.id);
                  if (selectedBlockIdsRef.current.size > 0) setSelectedBlockIds(new Set());
                }}
                onDelete={() => removeBlock(block.id)}
                onDuplicate={() => insertBlockAfter(block.id, { ...createDefaultBlock(block.type), ...block, id: `${block.id}-copy-${Date.now()}` })}
                menuOpen={blockMenuOpen === block.id}
                onMenuToggle={() => setBlockMenuOpen((prev) => (prev === block.id ? null : block.id))}
                onGutterMouseDown={() => {
                  dragSelectStartIndexRef.current = index;
                  dragSelectAnchorIndexRef.current = index;
                  setDragSelectActive(true);
                  setSelectedBlockIds(new Set([block.id]));
                  setActiveBlockId(null);
                }}
                onGutterMouseEnter={() => {
                  if (!dragSelectActive) return;
                  const startIdx = dragSelectStartIndexRef.current;
                  if (startIdx === null) return;
                  const lo = Math.min(startIdx, index);
                  const hi = Math.max(startIdx, index);
                  setSelectedBlockIds(new Set(blocks.slice(lo, hi + 1).map((b) => b.id)));
                }}
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
                  const draggedId = blocks[fromIndex]?.id;
                  const sel = selectedBlockIdsRef.current;
                  const isGroupDrag = !!draggedId && sel.has(draggedId) && sel.size > 1;

                  if (isGroupDrag) {
                    setBlocks((current) => {
                      pushHistory(current);
                      const selected = current.filter((b) => sel.has(b.id));
                      const rest = current.filter((b) => !sel.has(b.id));
                      const removedBefore = current.slice(0, targetIndex).filter((b) => sel.has(b.id)).length;
                      const insertAt = Math.max(0, Math.min(targetIndex - removedBefore, rest.length));
                      rest.splice(insertAt, 0, ...selected);
                      return rest;
                    });
                  } else {
                    const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
                    if (fromIndex !== adjustedIndex) {
                      setBlocks((current) => {
                        pushHistory(current);
                        return moveBlock(current, fromIndex, adjustedIndex);
                      });
                    }
                  }
                  dragIndexRef.current = null;
                  setDraggingBlockId(null);
                  setDropIndicator(null);
                }}
                showDropBefore={dropIndicator?.blockId === block.id && dropIndicator.position === "before"}
                showDropAfter={dropIndicator?.blockId === block.id && dropIndicator.position === "after"}
                isDragging={draggingBlockId !== null && (draggingBlockId === block.id || (selectedBlockIds.has(block.id) && selectedBlockIds.has(draggingBlockId)))}
              >
                {renderEditorBlock({
                  block,
                  blockIndex: index,
                  blocks,
                  active: block.id === activeBlockId,
                  slashMenuOpen: slashState?.blockId === block.id,
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
                  mergeWithPrevious: mergeBlockWithPrevious,
                  mergeListItemWithPrevious,
                  clearSelection: () => setSelectedBlockIds(new Set()),
                  isComposing: () => composingRef.current,
                })}
              </BlockShell>
            ))}
          </div>
        )}
      </div>

      {slashState && filteredCommands.length > 0 && !isReadOnly && slashMenuPos && (
        <div
          role="listbox"
          aria-label="Slash commands"
          className="fixed z-30 flex w-72 flex-col overflow-hidden border-2 border-black bg-[var(--color-surface)] p-2 kaya-popover-enter"
          style={{ ...slashMenuPos, maxHeight: "min(60vh, 480px)", borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        >
          <div className="border-b-2 border-black px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-muted)] font-mono">
            Slash Commands
          </div>
          <div className="mt-2 flex-1 space-y-1 overflow-y-auto">
            {filteredCommands.map((command, i) => {
              const isHover = i === Math.min(slashHoverIndex, filteredCommands.length - 1);
              return (
                <button
                  key={command.key}
                  onMouseEnter={() => setSlashHoverIndex(i)}
                  onClick={() => applySlashCommand(command)}
                  className={`flex w-full items-center gap-2 border-2 px-2 py-2 text-left ${isHover ? "border-black bg-[var(--color-muted-bg)]" : "border-transparent"}`}
                  style={{ borderRadius: "var(--border-radius)" }}
                >
                  {icon(command.label.slice(0, 2).toUpperCase())}
                  <span className="flex-1">
                    <span className="block text-xs font-bold uppercase tracking-wide font-mono">{command.label}</span>
                    <span className="block text-xs text-[var(--color-muted)] font-mono">{command.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dragSelectActive && lassoRect && (
        <div
          style={{
            position: "fixed",
            left: lassoRect.x,
            top: lassoRect.y,
            width: lassoRect.w,
            height: lassoRect.h,
            background: "var(--color-accent)",
            opacity: 0.12,
            border: "1.5px solid var(--color-accent)",
            borderRadius: 2,
            pointerEvents: "none",
            zIndex: 100,
          }}
        />
      )}
    </div>
    </EditorContextProvider>
  );
}

export { MarkdownContent } from "./markdown/MarkdownContent";
export { MermaidDiagram } from "./markdown/MermaidDiagram";
export type { EditorPosition, EditorSelection } from "./selection";
export { captureSelection, restoreSelection } from "./selection";
