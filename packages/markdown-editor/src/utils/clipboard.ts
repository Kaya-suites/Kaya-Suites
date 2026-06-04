const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const BLOCK_TAGS_SELECTOR = Array.from(BLOCK_TAGS).join(",");

function hasMeaningfulBlockDescendant(element: HTMLElement) {
  return element.querySelector(BLOCK_TAGS_SELECTOR) !== null;
}

function unwrapClipboardElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
}

function getClipboardListLevel(item: HTMLLIElement) {
  const raw = Number.parseInt(item.getAttribute("aria-level") ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function getFirstClipboardListLevel(list: HTMLUListElement | HTMLOListElement) {
  const firstItem = list.querySelector("li");
  return firstItem instanceof HTMLLIElement ? getClipboardListLevel(firstItem) : 1;
}

function promoteStyledInlineFormatting(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("span, b, strong, em, i").forEach((element) => {
    if (hasMeaningfulBlockDescendant(element)) return;

    const wrappers: string[] = [];
    const tag = element.tagName.toLowerCase();
    const fontWeight = element.style.fontWeight.trim().toLowerCase();
    const numericWeight = Number.parseInt(fontWeight, 10);
    const isBold =
      tag === "b" ||
      tag === "strong" ||
      fontWeight === "bold" ||
      fontWeight === "bolder" ||
      (!Number.isNaN(numericWeight) && numericWeight >= 600);
    const isItalic = tag === "i" || tag === "em" || element.style.fontStyle.trim().toLowerCase() === "italic";
    const textDecoration = element.style.textDecoration + " " + element.style.textDecorationLine;
    const isStrike = ["s", "strike", "del"].includes(tag) || textDecoration.includes("line-through");

    if (isBold) wrappers.push("strong");
    if (isItalic) wrappers.push("em");
    if (isStrike) wrappers.push("s");
    if (wrappers.length === 0) {
      unwrapClipboardElement(element);
      return;
    }

    let content: Node = (root.ownerDocument ?? document).createDocumentFragment();
    while (element.firstChild) {
      content.appendChild(element.firstChild);
    }

    wrappers.forEach((wrapperTag) => {
      const wrapper = (root.ownerDocument ?? document).createElement(wrapperTag);
      wrapper.appendChild(content);
      content = wrapper;
    });

    element.replaceWith(content);
  });
}

function repairClipboardListStructure(root: ParentNode) {
  let changed = false;

  root.querySelectorAll("ul,ol").forEach((list) => {
    let previousLi: HTMLLIElement | null = null;
    Array.from(list.children).forEach((child) => {
      if (child instanceof HTMLLIElement) {
        previousLi = child;
        return;
      }

      if ((child instanceof HTMLUListElement || child instanceof HTMLOListElement) && previousLi) {
        previousLi.appendChild(child);
        changed = true;
      }
    });
  });

  Array.from(root.childNodes).forEach((node) => {
    if (!(node instanceof HTMLUListElement || node instanceof HTMLOListElement)) return;
    const previous = node.previousElementSibling;
    if (!(previous instanceof HTMLUListElement || previous instanceof HTMLOListElement)) return;

    const currentLevel = getFirstClipboardListLevel(node);
    const previousLevel = getFirstClipboardListLevel(previous);
    const previousLastItem = previous.lastElementChild;

    if (currentLevel > previousLevel && previousLastItem instanceof HTMLLIElement) {
      previousLastItem.appendChild(node);
      changed = true;
      return;
    }

    if (currentLevel === previousLevel && previous.tagName === node.tagName) {
      while (node.firstChild) {
        previous.appendChild(node.firstChild);
      }
      node.remove();
      changed = true;
    }
  });

  return changed;
}

import { sanitizePasteHtml } from "../sanitize";

export function normalizeClipboardHtml(html: string) {
  if (typeof window === "undefined") return html;

  // Sanitize FIRST so any malicious tags/attributes (script, onerror, javascript: hrefs)
  // are gone before we walk the DOM. The downstream normalization steps assume clean input.
  const safe = sanitizePasteHtml(html);

  const template = window.document.createElement("template");
  template.innerHTML = safe;

  template.content.querySelectorAll("meta").forEach((node) => node.remove());

  // Reverse so inner elements are processed before their parents — after an inner
  // element is unwrapped its former parent may gain a direct block child, which the
  // parent check then correctly detects.
  Array.from(template.content.querySelectorAll<HTMLElement>("[id^='docs-internal-guid-'], b, strong, em, i, span")).reverse().forEach((element) => {
    if (hasMeaningfulBlockDescendant(element)) {
      unwrapClipboardElement(element);
    }
  });

  let repairIterations = 0;
  while (repairIterations < 20 && repairClipboardListStructure(template.content)) {
    repairIterations += 1;
  }

  promoteStyledInlineFormatting(template.content);

  return template.innerHTML;
}
