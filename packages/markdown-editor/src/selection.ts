export type EditorPosition = {
  blockId: string;
  itemId?: string;
  offset: number;
};

export type EditorSelection = {
  anchor: EditorPosition;
  focus: EditorPosition;
};

export function captureSelection(rootEl: HTMLElement): EditorSelection | null {
  const win = rootEl.ownerDocument?.defaultView;
  const sel = win?.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!rootEl.contains(sel.anchorNode) || !rootEl.contains(sel.focusNode)) return null;
  const anchor = positionFromDom(rootEl, sel.anchorNode, sel.anchorOffset);
  const focus = positionFromDom(rootEl, sel.focusNode, sel.focusOffset);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

// Capture caret/selection bounds within a single known element, bypassing the
// data-block-id lookup. Use when the caller already owns the container (e.g.
// EditableHtml preserving caret across its own innerHTML rewrite).
export function captureOffsetWithin(element: HTMLElement): { anchor: number; focus: number } | null {
  const win = element.ownerDocument?.defaultView;
  const sel = win?.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!element.contains(sel.anchorNode) || !element.contains(sel.focusNode)) return null;
  return {
    anchor: offsetWithinContainer(element, sel.anchorNode, sel.anchorOffset),
    focus: offsetWithinContainer(element, sel.focusNode, sel.focusOffset),
  };
}

export function restoreOffsetWithin(
  element: HTMLElement,
  offsets: { anchor: number; focus: number },
): boolean {
  const anchor = walkToOffset(element, offsets.anchor);
  const focus = walkToOffset(element, offsets.focus);
  const win = element.ownerDocument?.defaultView;
  const sel = win?.getSelection();
  if (!sel) return false;
  const range = element.ownerDocument.createRange();
  try {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } catch {
    return false;
  }
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function restoreSelection(rootEl: HTMLElement, selection: EditorSelection): boolean {
  const anchor = positionToDom(rootEl, selection.anchor);
  const focus = positionToDom(rootEl, selection.focus);
  if (!anchor || !focus) return false;
  const win = rootEl.ownerDocument?.defaultView;
  const sel = win?.getSelection();
  if (!sel) return false;
  const range = rootEl.ownerDocument.createRange();
  try {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } catch {
    return false;
  }
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function positionFromDom(rootEl: HTMLElement, node: Node, offset: number): EditorPosition | null {
  const container = findEnclosingBlock(rootEl, node);
  if (!container) return null;
  const codePoints = offsetWithinContainer(container.blockEl, node, offset);
  return { blockId: container.blockId, itemId: container.itemId, offset: codePoints };
}

function positionToDom(rootEl: HTMLElement, pos: EditorPosition): { node: Node; offset: number } | null {
  const blockEl = findBlock(rootEl, pos.blockId, pos.itemId);
  if (!blockEl) return null;
  return walkToOffset(blockEl, pos.offset);
}

function findEnclosingBlock(
  rootEl: HTMLElement,
  node: Node,
): { blockEl: HTMLElement; blockId: string; itemId?: string } | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  let itemId: string | undefined;
  let itemEl: HTMLElement | null = null;
  while (el && rootEl.contains(el)) {
    if (!itemId) {
      const id = el.getAttribute("data-item-id");
      if (id) {
        itemId = id;
        itemEl = el;
      }
    }
    const blockId = el.getAttribute("data-block-id");
    if (blockId) {
      // Use the inner container (the item) when present so the offset is local to it.
      return { blockEl: itemEl ?? el, blockId, itemId };
    }
    el = el.parentElement;
  }
  return null;
}

function findBlock(rootEl: HTMLElement, blockId: string, itemId?: string): HTMLElement | null {
  if (itemId) {
    const item = rootEl.querySelector<HTMLElement>(`[data-item-id="${cssEscape(itemId)}"]`);
    if (item) return item;
  }
  return rootEl.querySelector<HTMLElement>(`[data-block-id="${cssEscape(blockId)}"]`);
}

function offsetWithinContainer(container: HTMLElement, node: Node, offset: number): number {
  const doc = container.ownerDocument;
  if (!doc) return 0;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let codePointsBefore = 0;

  if (node.nodeType === Node.TEXT_NODE && container.contains(node)) {
    let current = walker.nextNode();
    while (current && current !== node) {
      codePointsBefore += codePointLength((current as Text).data);
      current = walker.nextNode();
    }
    const slice = (node as Text).data.slice(0, offset);
    return codePointsBefore + codePointLength(slice);
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const targetChild = (node as Element).childNodes[offset] ?? null;
    let current = walker.nextNode();
    while (current) {
      if (targetChild && (current === targetChild || targetChild.contains(current))) break;
      codePointsBefore += codePointLength((current as Text).data);
      current = walker.nextNode();
    }
    return codePointsBefore;
  }

  return 0;
}

function walkToOffset(container: HTMLElement, codePointOffset: number): { node: Node; offset: number } {
  const doc = container.ownerDocument;
  if (!doc) return { node: container, offset: 0 };
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, codePointOffset);
  let lastText: Text | null = null;
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const len = codePointLength(text.data);
    if (remaining <= len) {
      return { node: text, offset: codePointOffsetToUtf16(text.data, remaining) };
    }
    remaining -= len;
    lastText = text;
    current = walker.nextNode();
  }
  if (lastText) return { node: lastText, offset: lastText.data.length };
  return { node: container, offset: 0 };
}

function codePointLength(s: string): number {
  return Array.from(s).length;
}

function codePointOffsetToUtf16(s: string, codePoints: number): number {
  let utf16 = 0;
  let cp = 0;
  for (const ch of s) {
    if (cp >= codePoints) break;
    utf16 += ch.length;
    cp++;
  }
  return utf16;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
