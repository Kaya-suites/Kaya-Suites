import { inlineHtmlToMarkdown, type MarkdownBlock } from "@kaya/markdown-model";

export function isCaretAtStart(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const testRange = document.createRange();
  testRange.selectNodeContents(el);
  testRange.setEnd(range.startContainer, range.startOffset);
  return (testRange.cloneContents().textContent?.length ?? 0) === 0;
}

export function isCaretAtFirstLine(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return true;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const caretRect = range.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (caretRect.height === 0) return true;
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || caretRect.height;
  return caretRect.top < elRect.top + lineHeight;
}

export function isCaretAtEnd(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.endContainer)) return false;
  const testRange = document.createRange();
  testRange.selectNodeContents(el);
  testRange.setStart(range.endContainer, range.endOffset);
  return (testRange.cloneContents().textContent?.length ?? 0) === 0;
}

export function isCaretAtLastLine(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return true;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return false;
  const caretRect = range.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (caretRect.height === 0) return true;
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || caretRect.height;
  return caretRect.bottom > elRect.bottom - lineHeight;
}

function serializeRangeContents(range: Range) {
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());
  return container.innerHTML;
}

export function getSplitHtmlAtSelection(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.selectNodeContents(root);
  afterRange.setStart(range.endContainer, range.endOffset);

  return {
    beforeHtml: serializeRangeContents(beforeRange),
    afterHtml: serializeRangeContents(afterRange),
  };
}

export function getClosestAnchor(node: Node | null) {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLAnchorElement) return current;
    current = current.parentNode;
  }
  return null;
}

export function logMarkdownSegments(label: string, segments: Array<{ kind: "newline" | "content"; value: string }>) {
  if (segments.length === 0) {
    console.log(label, { index: 0, kind: "empty", value: "" });
    return;
  }

  segments.forEach((segment, index) => {
    console.log(label, {
      index,
      kind: segment.kind,
      value: segment.value,
    });
  });
}

export function isEmptyBlock(block: MarkdownBlock) {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
    case "heading":
      return inlineHtmlToMarkdown(block.html).trim() === "";
    case "list":
      return block.items.length === 1 && inlineHtmlToMarkdown(block.items[0].html).trim() === "";
    case "code":
      return block.code.trim() === "";
    case "html":
      return block.source.trim() === "";
    case "image":
      return !block.src.trim() && !block.alt.trim() && !block.title.trim();
    case "table":
      return block.header.every((cell) => cell.trim() === "") && block.rows.every((row) => row.every((cell) => cell.trim() === ""));
    case "callout":
      return inlineHtmlToMarkdown(block.html).trim() === "";
    case "toggle":
      return block.summary.trim() === "" && inlineHtmlToMarkdown(block.html).trim() === "";
    case "hr":
      return false;
  }
}

export function shouldSplitPasteIntoBlocks(text: string, parsedBlocks: MarkdownBlock[]) {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return false;

  if (parsedBlocks.length > 1) return true;

  const [firstBlock] = parsedBlocks;
  if (!firstBlock) return false;
  if (firstBlock.type !== "paragraph") return true;

  return /\n\s*\n/.test(normalized) || /^(#{1,6}\s+|>\s?|[-*_]{3,}\s*$|```|(\s*)([-+*]|\d+\.)\s+|!\[[^\]]*]\([^)]+\)|<([a-zA-Z][\w-]*)(\s[^>]*)?>)/m.test(normalized);
}

export function canFocusBlock(block: MarkdownBlock) {
  return (
    block.type === "paragraph" ||
    block.type === "blockquote" ||
    block.type === "heading" ||
    block.type === "callout" ||
    block.type === "toggle"
  );
}

export async function uploadImageFile(file: File) {
  // TODO: Replace this with the real upload pipeline when storage is finalized.
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

export function blockLabel(block: MarkdownBlock) {
  switch (block.type) {
    case "paragraph":
      return "Paragraph";
    case "heading":
      return `H${block.level}`;
    case "blockquote":
      return "Quote";
    case "list":
      return block.items.some((item) => item.checked !== null)
        ? "Tasks"
        : block.items.some((item) => item.ordered)
          ? "Numbered"
          : "Bullets";
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
    case "callout":
      return "Callout";
    case "toggle":
      return "Toggle";
  }
}

export function computeOrderedNumber(blocks: MarkdownBlock[], blockIndex: number, depth: number): number {
  let count = 1;
  let i = blockIndex - 1;
  while (i >= 0) {
    const b = blocks[i];
    if (b.type !== "list") break;
    const item = b.items[0];
    if (item.depth < depth) break;
    if (item.depth > depth) { i--; continue; }
    if (!item.ordered) break;
    count++;
    i--;
  }
  return count;
}

export function getTextBlockHtml(block: MarkdownBlock) {
  if (block.type === "paragraph" || block.type === "blockquote" || block.type === "heading") {
    return block.html;
  }
  if (block.type === "callout" || block.type === "toggle") {
    return block.html;
  }
  return "";
}

export function getCaretXFromSelection(): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.left === 0 && rect.top === 0) return null;
  return rect.left;
}

export function placeCaretAtX(el: HTMLElement, x: number, atTop: boolean): boolean {
  const elRect = el.getBoundingClientRect();
  const y = atTop ? elRect.top + 4 : elRect.bottom - 4;
  type DocLike = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const doc = document as DocLike;
  let range: Range | null = null;
  if (typeof doc.caretRangeFromPoint === "function") {
    range = doc.caretRangeFromPoint(x, y);
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range || !el.contains(range.startContainer)) return false;
  el.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}
