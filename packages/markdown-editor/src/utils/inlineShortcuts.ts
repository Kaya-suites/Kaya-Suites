const MAX_LOOKBACK = 80;

type Pattern = {
  closer: string;
  opener: string;
  wrap: (inner: string) => string;
};

const PATTERNS: Pattern[] = [
  { closer: "**", opener: "**", wrap: (s) => `<strong>${s}</strong>` },
  { closer: "__", opener: "__", wrap: (s) => `<strong>${s}</strong>` },
  { closer: "~~", opener: "~~", wrap: (s) => `<s>${s}</s>` },
  { closer: "*",  opener: "*",  wrap: (s) => `<em>${s}</em>` },
  { closer: "_",  opener: "_",  wrap: (s) => `<em>${s}</em>` },
  { closer: "`",  opener: "`",  wrap: (s) => `<code>${s}</code>` },
];

function getPlainTextBefore(root: HTMLElement, endNode: Node, endOffset: number): string {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(endNode, endOffset);
  } catch {
    return "";
  }
  return range.cloneContents().textContent ?? "";
}

function findOpenerOffset(text: string, opener: string, closerStartInText: number): number {
  for (let i = closerStartInText - opener.length; i >= 0; i--) {
    if (text.slice(i, i + opener.length) === opener) {
      if (i + opener.length === closerStartInText) continue;
      const inner = text.slice(i + opener.length, closerStartInText);
      if (inner.trim().length === 0) continue;
      if (/\s$/.test(inner)) continue;
      return i;
    }
    if (closerStartInText - i > MAX_LOOKBACK) break;
  }
  return -1;
}

function replaceTextRangeWithHtml(
  root: HTMLElement,
  textStart: number,
  textEnd: number,
  html: string,
): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent?.length ?? 0;
    if (startNode === null && consumed + len >= textStart) {
      startNode = node;
      startOffset = textStart - consumed;
    }
    if (consumed + len >= textEnd) {
      endNode = node;
      endOffset = textEnd - consumed;
      break;
    }
    consumed += len;
  }

  if (!startNode || !endNode) return false;

  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    return false;
  }

  range.deleteContents();

  const fragment = document.createRange().createContextualFragment(html);
  const lastChild = fragment.lastChild;
  range.insertNode(fragment);

  const sel = window.getSelection();
  if (sel && lastChild) {
    const after = document.createRange();
    after.setStartAfter(lastChild);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  return true;
}

function escapeText(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function tryInlineShortcut(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return false;

  const textBeforeCaret = getPlainTextBefore(root, range.endContainer, range.endOffset);
  if (!textBeforeCaret) return false;

  for (const { closer, opener, wrap } of PATTERNS) {
    if (!textBeforeCaret.endsWith(closer)) continue;
    const closerStart = textBeforeCaret.length - closer.length;

    if (closer === "*" || closer === "_") {
      const prev2 = textBeforeCaret.slice(closerStart - 1, closerStart);
      const next1 = textBeforeCaret.slice(closerStart + closer.length, closerStart + closer.length + 1);
      if (prev2 === closer || next1 === closer) continue;
    }

    const openerOffset = findOpenerOffset(textBeforeCaret, opener, closerStart);
    if (openerOffset < 0) continue;

    const inner = textBeforeCaret.slice(openerOffset + opener.length, closerStart);
    const html = wrap(escapeText(inner));

    if (replaceTextRangeWithHtml(root, openerOffset, textBeforeCaret.length, html)) {
      return true;
    }
  }

  const linkMatch = textBeforeCaret.match(/\[([^\]]+)]\(([^)\s]+)\)$/);
  if (linkMatch) {
    const start = textBeforeCaret.length - linkMatch[0].length;
    const html = `<a href="${escapeText(linkMatch[2])}">${escapeText(linkMatch[1])}</a>`;
    if (replaceTextRangeWithHtml(root, start, textBeforeCaret.length, html)) {
      return true;
    }
  }

  return false;
}
