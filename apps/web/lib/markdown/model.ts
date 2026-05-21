export type MarkdownAlignment = "left" | "center" | "right" | null;

export type MarkdownListItem = {
  id: string;
  depth: number;
  checked: boolean | null;
  html: string;
};

export type MarkdownBlock =
  | { id: string; type: "paragraph"; html: string }
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; html: string }
  | { id: string; type: "blockquote"; html: string }
  | { id: string; type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { id: string; type: "table"; alignments: MarkdownAlignment[]; header: string[]; rows: string[][] }
  | { id: string; type: "code"; language: string; code: string }
  | { id: string; type: "image"; alt: string; src: string; title: string }
  | { id: string; type: "hr" }
  | { id: string; type: "html"; source: string };

type InlineToken =
  | { type: "text"; value: string }
  | { type: "html"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: InlineToken[] }
  | { type: "em"; children: InlineToken[] }
  | { type: "strike"; children: InlineToken[] }
  | { type: "link"; href: string; children: InlineToken[] }
  | { type: "image"; src: string; alt: string };

const BLOCK_START_PATTERNS = [
  /^#{1,6}\s+/,
  /^>\s?/,
  /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  /^```/,
  /^(\s*)([-+*]|\d+\.)\s+/,
  /^<([a-zA-Z][\w-]*)(\s[^>]*)?>/,
];

let idCounter = 0;

function createId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function stripOuterParagraph(html: string) {
  const trimmed = html.trim();
  if (trimmed.startsWith("<p>") && trimmed.endsWith("</p>")) {
    return trimmed.slice(3, -4);
  }
  return trimmed;
}

function isImageOnlyLine(value: string) {
  return /^!\[[^\]]*]\([^)]+\)$/.test(value.trim());
}

function parseImageLine(value: string) {
  const match = value.trim().match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/);
  if (!match) return null;
  return {
    alt: match[1],
    src: match[2],
    title: match[3] ?? "",
  };
}

function parseAlignmentCell(cell: string): MarkdownAlignment {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function alignmentToMarkdown(alignment: MarkdownAlignment) {
  switch (alignment) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

function splitTableRow(line: string) {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function isAlignmentRow(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number) {
  if (index + 1 >= lines.length) return false;
  return lines[index].includes("|") && isAlignmentRow(lines[index + 1]);
}

function isHtmlBlockStart(line: string) {
  const trimmed = line.trim();
  return /^<([a-zA-Z][\w-]*)(\s[^>]*)?>/.test(trimmed) || /^<!DOCTYPE/i.test(trimmed);
}

function isBlockStart(line: string) {
  return BLOCK_START_PATTERNS.some((pattern) => pattern.test(line)) || isHtmlBlockStart(line);
}

function parseInlineTokens(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);

    if (rest.startsWith("`")) {
      const end = source.indexOf("`", index + 1);
      if (end > index) {
        tokens.push({ type: "code", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith("![") ) {
      const match = rest.match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"([^"]+)")?\)/);
      if (match) {
        tokens.push({ type: "image", alt: match[1], src: match[2] });
        index += match[0].length;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const match = rest.match(/^\[([^\]]+)]\(([^)\s]+)(?:\s+"([^"]+)")?\)/);
      if (match) {
        tokens.push({
          type: "link",
          href: match[2],
          children: parseInlineTokens(match[1]),
        });
        index += match[0].length;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = source.indexOf("**", index + 2);
      if (end > index) {
        tokens.push({ type: "strong", children: parseInlineTokens(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("~~")) {
      const end = source.indexOf("~~", index + 2);
      if (end > index) {
        tokens.push({ type: "strike", children: parseInlineTokens(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("*")) {
      const end = source.indexOf("*", index + 1);
      if (end > index) {
        tokens.push({ type: "em", children: parseInlineTokens(source.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith("<")) {
      const end = source.indexOf(">", index + 1);
      if (end > index) {
        tokens.push({ type: "html", value: source.slice(index, end + 1) });
        index = end + 1;
        continue;
      }
    }

    let next = source.length;
    for (const marker of ["`", "![", "[", "**", "~~", "*", "<"]) {
      const markerIndex = source.indexOf(marker, index + 1);
      if (markerIndex !== -1) next = Math.min(next, markerIndex);
    }
    tokens.push({ type: "text", value: source.slice(index, next) });
    index = next;
  }

  return tokens;
}

function inlineTokensToHtml(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
          return escapeHtml(token.value);
        case "html":
          return token.value;
        case "code":
          return `<code>${escapeHtml(token.value)}</code>`;
        case "strong":
          return `<strong>${inlineTokensToHtml(token.children)}</strong>`;
        case "em":
          return `<em>${inlineTokensToHtml(token.children)}</em>`;
        case "strike":
          return `<s>${inlineTokensToHtml(token.children)}</s>`;
        case "link":
          return `<a href="${escapeHtml(token.href)}">${inlineTokensToHtml(token.children)}</a>`;
        case "image":
          return `<img src="${escapeHtml(token.src)}" alt="${escapeHtml(token.alt)}" />`;
      }
    })
    .join("");
}

export function inlineMarkdownToHtml(source: string) {
  return inlineTokensToHtml(parseInlineTokens(source));
}

function serializeInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName.toLowerCase();

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${serializeInlineChildren(node)}**`;
  if (tag === "em" || tag === "i") return `*${serializeInlineChildren(node)}*`;
  if (tag === "s" || tag === "strike" || tag === "del") return `~~${serializeInlineChildren(node)}~~`;
  if (tag === "code") return `\`${node.textContent ?? ""}\``;
  if (tag === "a") return `[${serializeInlineChildren(node)}](${node.getAttribute("href") ?? ""})`;
  if (tag === "img") return `![${node.getAttribute("alt") ?? ""}](${node.getAttribute("src") ?? ""})`;
  if (tag === "span" && node.dataset.rawHtml === "true") return node.dataset.source ?? node.textContent ?? "";

  return serializeInlineChildren(node);
}

function serializeInlineChildren(node: HTMLElement): string {
  return Array.from(node.childNodes)
    .map((child) => serializeInlineNode(child))
    .join("");
}

export function inlineHtmlToMarkdown(html: string): string {
  if (typeof window === "undefined") {
    return decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, _tag, content: string) => `**${inlineHtmlToMarkdown(content)}**`)
        .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, _tag, content: string) => `*${inlineHtmlToMarkdown(content)}*`)
        .replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/gi, (_, _tag, content: string) => `~~${inlineHtmlToMarkdown(content)}~~`)
        .replace(/<code>([\s\S]*?)<\/code>/gi, (_match, content: string) => `\`${decodeEntities(content)}\``)
        .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, content: string) => `[${inlineHtmlToMarkdown(content)}](${href})`)
        .replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_match, src: string, alt: string) => `![${alt}](${src})`)
        .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*\/?>/gi, (_match, alt: string, src: string) => `![${alt}](${src})`)
        .replace(/<[^>]+>/g, ""),
    );
  }

  const template = window.document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes)
    .map((node) => serializeInlineNode(node))
    .join("")
    .replace(/\u00a0/g, " ");
}

function paragraphBlock(markdown: string): MarkdownBlock {
  return {
    id: createId("p"),
    type: "paragraph",
    html: inlineMarkdownToHtml(markdown),
  };
}

function parseList(lines: string[], startIndex: number) {
  const items: MarkdownListItem[] = [];
  let ordered = false;
  let start = 1;
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
    if (!match) break;
    const indent = match[1].length;
    const marker = match[2];
    const content = match[3];

    if (items.length === 0) {
      ordered = /\d+\./.test(marker);
      if (ordered) start = Number.parseInt(marker, 10) || 1;
    }

    const taskMatch = content.match(/^\[( |x|X)]\s+(.*)$/);

    items.push({
      id: createId("li"),
      depth: Math.floor(indent / 2),
      checked: taskMatch ? taskMatch[1].toLowerCase() === "x" : null,
      html: inlineMarkdownToHtml(taskMatch ? taskMatch[2] : content),
    });

    index += 1;
  }

  return {
    nextIndex: index,
    block: {
      id: createId("list"),
      type: "list",
      ordered,
      start,
      items,
    } satisfies MarkdownBlock,
  };
}

function parseTable(lines: string[], startIndex: number) {
  const header = splitTableRow(lines[startIndex]).map((cell) => inlineMarkdownToHtml(cell));
  const alignments = splitTableRow(lines[startIndex + 1]).map(parseAlignmentCell);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
    rows.push(splitTableRow(lines[index]).map((cell) => inlineMarkdownToHtml(cell)));
    index += 1;
  }

  return {
    nextIndex: index,
    block: {
      id: createId("table"),
      type: "table",
      alignments,
      header,
      rows,
    } satisfies MarkdownBlock,
  };
}

export function parseMarkdownToBlocks(markdown: string): MarkdownBlock[] {
  const input = markdown.replace(/\r\n/g, "\n").trim();
  if (!input) {
    return [paragraphBlock("")];
  }

  const lines = input.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      index += 1;
      const buffer: string[] = [];
      while (index < lines.length && !lines[index].startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        id: createId("code"),
        type: "code",
        language,
        code: buffer.join("\n"),
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    if (/^(\s*)([-+*]|\d+\.)\s+/.test(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        id: createId("heading"),
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        html: inlineMarkdownToHtml(headingMatch[2]),
      });
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ id: createId("hr"), type: "hr" });
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const buffer: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        buffer.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({
        id: createId("quote"),
        type: "blockquote",
        html: inlineMarkdownToHtml(buffer.join("\n")),
      });
      continue;
    }

    if (isImageOnlyLine(line)) {
      const image = parseImageLine(line);
      if (image) {
        blocks.push({
          id: createId("image"),
          type: "image",
          alt: image.alt,
          src: image.src,
          title: image.title,
        });
        index += 1;
        continue;
      }
    }

    if (isHtmlBlockStart(line)) {
      const buffer: string[] = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "") {
        buffer.push(lines[index]);
        index += 1;
      }
      blocks.push({
        id: createId("html"),
        type: "html",
        source: buffer.join("\n"),
      });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !isBlockStart(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(paragraphBlock(paragraphLines.join(" ")));
  }

  return blocks.length > 0 ? blocks : [paragraphBlock("")];
}

export function serializeBlocksToMarkdown(blocks: MarkdownBlock[]) {
  const parts = blocks.map((block) => {
    switch (block.type) {
      case "paragraph":
        return inlineHtmlToMarkdown(block.html).trimEnd();
      case "heading":
        return `${"#".repeat(block.level)} ${inlineHtmlToMarkdown(block.html).trim()}`.trimEnd();
      case "blockquote":
        return inlineHtmlToMarkdown(block.html)
          .split("\n")
          .map((line: string) => `> ${line}`)
          .join("\n");
      case "list": {
        const counters = new Map<number, number>();
        return block.items
          .map((item) => {
            const indent = "  ".repeat(item.depth);
            if (block.ordered) {
              const current = counters.get(item.depth) ?? (item.depth === 0 ? block.start : 1);
              counters.set(item.depth, current + 1);
              return `${indent}${current}. ${item.checked !== null ? `[${item.checked ? "x" : " "}] ` : ""}${inlineHtmlToMarkdown(item.html).trim()}`;
            }
            return `${indent}- ${item.checked !== null ? `[${item.checked ? "x" : " "}] ` : ""}${inlineHtmlToMarkdown(item.html).trim()}`;
          })
          .join("\n");
      }
      case "table": {
        const header = `| ${block.header.map((cell) => inlineHtmlToMarkdown(cell).trim()).join(" | ")} |`;
        const alignments = `| ${block.alignments.map(alignmentToMarkdown).join(" | ")} |`;
        const rows = block.rows.map(
          (row) => `| ${row.map((cell) => inlineHtmlToMarkdown(cell).trim()).join(" | ")} |`,
        );
        return [header, alignments, ...rows].join("\n");
      }
      case "code":
        return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
      case "image": {
        const title = block.title ? ` "${block.title}"` : "";
        return `![${block.alt}](${block.src}${title})`;
      }
      case "hr":
        return "---";
      case "html":
        return block.source.trimEnd();
    }
  });

  return parts.join("\n\n").trim();
}

export function duplicateBlock(block: MarkdownBlock): MarkdownBlock {
  return JSON.parse(JSON.stringify({ ...block, id: createId(block.type) })) as MarkdownBlock;
}

export function createDefaultBlock(type: MarkdownBlock["type"]): MarkdownBlock {
  switch (type) {
    case "heading":
      return { id: createId("heading"), type: "heading", level: 2, html: "" };
    case "blockquote":
      return { id: createId("quote"), type: "blockquote", html: "" };
    case "list":
      return {
        id: createId("list"),
        type: "list",
        ordered: false,
        start: 1,
        items: [{ id: createId("li"), depth: 0, checked: null, html: "" }],
      };
    case "table":
      return {
        id: createId("table"),
        type: "table",
        alignments: [null, null],
        header: ["", ""],
        rows: [["", ""]],
      };
    case "code":
      return { id: createId("code"), type: "code", language: "", code: "" };
    case "image":
      return { id: createId("image"), type: "image", alt: "", src: "", title: "" };
    case "hr":
      return { id: createId("hr"), type: "hr" };
    case "html":
      return { id: createId("html"), type: "html", source: "<div></div>" };
    case "paragraph":
      return { id: createId("p"), type: "paragraph", html: "" };
  }
}

export function moveBlock(blocks: MarkdownBlock[], fromIndex: number, toIndex: number) {
  const next = [...blocks];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function updateTableColumnAlignment(
  block: Extract<MarkdownBlock, { type: "table" }>,
  columnIndex: number,
  alignment: MarkdownAlignment,
) {
  const alignments = [...block.alignments];
  alignments[columnIndex] = alignment;
  return { ...block, alignments };
}

export function addTableRow(block: Extract<MarkdownBlock, { type: "table" }>, index: number) {
  const rows = [...block.rows];
  rows.splice(index, 0, Array.from({ length: block.header.length }, () => ""));
  return { ...block, rows };
}

export function removeTableRow(block: Extract<MarkdownBlock, { type: "table" }>, index: number) {
  const rows = block.rows.filter((_, rowIndex) => rowIndex !== index);
  return { ...block, rows: rows.length > 0 ? rows : [["", ""]] };
}

export function addTableColumn(block: Extract<MarkdownBlock, { type: "table" }>, index: number) {
  const header = [...block.header];
  const alignments = [...block.alignments];
  header.splice(index, 0, "");
  alignments.splice(index, 0, null);
  const rows = block.rows.map((row) => {
    const next = [...row];
    next.splice(index, 0, "");
    return next;
  });
  return { ...block, header, alignments, rows };
}

export function removeTableColumn(block: Extract<MarkdownBlock, { type: "table" }>, index: number) {
  const header = block.header.filter((_, columnIndex) => columnIndex !== index);
  const alignments = block.alignments.filter((_, columnIndex) => columnIndex !== index);
  const rows = block.rows.map((row) => row.filter((_, columnIndex) => columnIndex !== index));
  if (header.length === 0) {
    return {
      ...block,
      header: [""],
      alignments: [null],
      rows: [[""]],
    };
  }
  return { ...block, header, alignments, rows };
}

export function toggleTableHeader(block: Extract<MarkdownBlock, { type: "table" }>) {
  if (block.rows.length === 0) return block;
  return {
    ...block,
    header: [...block.rows[0]],
    rows: [block.header, ...block.rows.slice(1)],
  };
}

export function indentListItem(block: Extract<MarkdownBlock, { type: "list" }>, itemIndex: number) {
  return {
    ...block,
    items: block.items.map((item, index) =>
      index === itemIndex ? { ...item, depth: Math.min(item.depth + 1, 4) } : item,
    ),
  };
}

export function outdentListItem(block: Extract<MarkdownBlock, { type: "list" }>, itemIndex: number) {
  return {
    ...block,
    items: block.items.map((item, index) =>
      index === itemIndex ? { ...item, depth: Math.max(item.depth - 1, 0) } : item,
    ),
  };
}

export function splitListItem(
  block: Extract<MarkdownBlock, { type: "list" }>,
  itemIndex: number,
  beforeHtml: string,
  afterHtml: string,
) {
  const items = [...block.items];
  const current = items[itemIndex];
  items[itemIndex] = { ...current, html: beforeHtml };
  items.splice(itemIndex + 1, 0, {
    id: createId("li"),
    depth: current.depth,
    checked: current.checked,
    html: afterHtml,
  });
  return { ...block, items };
}

export function removeListItem(block: Extract<MarkdownBlock, { type: "list" }>, itemIndex: number) {
  const items = block.items.filter((_, index) => index !== itemIndex);
  if (items.length === 0) {
    items.push({ id: createId("li"), depth: 0, checked: null, html: "" });
  }
  return { ...block, items };
}

export function normalizeBlockHtml(block: MarkdownBlock): MarkdownBlock {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
      return { ...block, html: stripOuterParagraph(block.html) };
    case "heading":
      return { ...block, html: stripOuterParagraph(block.html) };
    default:
      return block;
  }
}
