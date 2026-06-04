export type MarkdownAlignment = "left" | "center" | "right" | null;

export type MarkdownListItem = {
  id: string;
  depth: number;
  ordered: boolean;
  checked: boolean | null;
  html: string;
};

export type MarkdownBlock =
  | { id: string; type: "paragraph"; html: string; depth: number }
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; html: string; depth: number }
  | { id: string; type: "blockquote"; html: string; depth: number }
  | { id: string; type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { id: string; type: "table"; alignments: MarkdownAlignment[]; header: string[]; rows: string[][] }
  | { id: string; type: "code"; language: string; code: string }
  | { id: string; type: "image"; alt: string; src: string; title: string }
  | { id: string; type: "hr" }
  | { id: string; type: "html"; source: string }
  | { id: string; type: "callout"; icon: string; html: string }
  | { id: string; type: "toggle"; summary: string; html: string; open: boolean };

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
      // Skip over any ** sequences so we don't close an em span inside bold markers.
      let end = source.indexOf("*", index + 1);
      while (end !== -1 && source[end + 1] === "*") {
        end = source.indexOf("*", end + 2);
      }
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

function paragraphBlock(markdown: string, depth = 0): MarkdownBlock {
  // Convert Markdown hard line breaks (two trailing spaces + newline) to <br>,
  // then collapse remaining soft-wrap newlines into spaces.
  const normalized = markdown.replace(/  \n/g, "<br>").replace(/\n/g, " ");
  return {
    id: createId("p"),
    type: "paragraph",
    depth,
    html: inlineMarkdownToHtml(normalized),
  };
}

function getIndentWidth(indent: string) {
  return indent.replace(/\t/g, "    ").length;
}

function parseList(lines: string[], startIndex: number): { nextIndex: number; blocks: MarkdownBlock[] } {
  const items: MarkdownListItem[] = [];
  let start = 1;
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(/^(\s*)([-+*]|\d+\.)\s+(.*)$/);
    if (!match) break;
    const indent = getIndentWidth(match[1]);
    const marker = match[2];
    const content = match[3];

    if (items.length === 0 && /\d+\./.test(marker)) {
      start = Number.parseInt(marker, 10) || 1;
    }

    const taskMatch = content.match(/^\[( |x|X)]\s+(.*)$/);

    items.push({
      id: createId("li"),
      depth: Math.floor(indent / 4),
      ordered: /\d+\./.test(marker),
      checked: taskMatch ? taskMatch[1].toLowerCase() === "x" : null,
      html: inlineMarkdownToHtml(taskMatch ? taskMatch[2] : content),
    });

    index += 1;
  }

  return {
    nextIndex: index,
    blocks: items.map((item, i) => ({
      id: createId("list"),
      type: "list" as const,
      ordered: item.ordered,
      start: i === 0 ? start : 1,
      items: [item],
    })),
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
      blocks.push(...list.blocks);
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
        depth: 0,
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
      function stripQuotePrefix(l: string): { quoteDepth: number; stripped: string } {
        let quoteDepth = 0;
        let stripped = l;
        while (stripped.startsWith(">")) {
          quoteDepth++;
          stripped = stripped.replace(/^>\s?/, "");
        }
        return { quoteDepth, stripped };
      }
      const first = stripQuotePrefix(line);
      const quoteDepth = first.quoteDepth;
      const buffer: string[] = [first.stripped];
      index += 1;
      while (index < lines.length && lines[index].startsWith(">")) {
        const { quoteDepth: d, stripped } = stripQuotePrefix(lines[index]);
        if (d !== quoteDepth) break;
        buffer.push(stripped);
        index += 1;
      }
      const headingMatch = buffer.length === 1 ? buffer[0].match(/^(#{1,6})\s+(.*)$/) : null;
      if (headingMatch) {
        blocks.push({
          id: createId("heading"),
          type: "heading",
          level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          html: inlineMarkdownToHtml(headingMatch[2]),
          depth: quoteDepth,
        });
      } else {
        blocks.push({
          id: createId("quote"),
          type: "blockquote",
          html: inlineMarkdownToHtml(buffer.join("\n")),
          depth: quoteDepth - 1,
        });
      }
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

    blocks.push(paragraphBlock(paragraphLines.join("\n")));
  }

  return blocks.length > 0 ? blocks : [paragraphBlock("")];
}

function serializeListRun(items: MarkdownListItem[], firstStart: number): string {
  const counters = new Map<number, number>();
  const markerKinds = new Map<number, "ordered" | "unordered">();
  return items
    .map((item) => {
      Array.from(counters.keys()).forEach((depth) => {
        if (depth > item.depth) counters.delete(depth);
      });
      Array.from(markerKinds.keys()).forEach((depth) => {
        if (depth > item.depth) markerKinds.delete(depth);
      });

      const indent = "    ".repeat(item.depth);
      const taskPrefix = item.checked !== null ? `[${item.checked ? "x" : " "}] ` : "";

      if (item.ordered) {
        const previousKind = markerKinds.get(item.depth);
        const initial = item.depth === 0 ? firstStart : 1;
        const current = previousKind === "ordered" ? (counters.get(item.depth) ?? initial) : initial;
        counters.set(item.depth, current + 1);
        markerKinds.set(item.depth, "ordered");
        return `${indent}${current}. ${taskPrefix}${inlineHtmlToMarkdown(item.html).trim()}`;
      }

      counters.delete(item.depth);
      markerKinds.set(item.depth, "unordered");
      return `${indent}- ${taskPrefix}${inlineHtmlToMarkdown(item.html).trim()}`;
    })
    .join("\n");
}

export function serializeBlocksToMarkdown(blocks: MarkdownBlock[]) {
  const parts: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "list") {
      const firstStart = block.start;
      const allItems: MarkdownListItem[] = [...block.items];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === "list") {
        allItems.push(...(blocks[j] as Extract<MarkdownBlock, { type: "list" }>).items);
        j++;
      }
      parts.push(serializeListRun(allItems, firstStart));
      i = j;
      continue;
    }

    switch (block.type) {
      case "paragraph": {
        const paraContent = inlineHtmlToMarkdown(block.html).trimEnd();
        const paraPrefix = "> ".repeat(block.depth);
        parts.push(paraPrefix + paraContent);
        break;
      }
      case "heading": {
        const headingContent = `${"#".repeat(block.level)} ${inlineHtmlToMarkdown(block.html).trim()}`.trimEnd();
        const headingPrefix = "> ".repeat(block.depth);
        parts.push(headingPrefix + headingContent);
        break;
      }
      case "blockquote": {
        const quotePrefix = "> ".repeat(block.depth + 1);
        parts.push(
          inlineHtmlToMarkdown(block.html)
            .split("\n")
            .map((line: string) => `${quotePrefix}${line}`)
            .join("\n"),
        );
        break;
      }
      case "table": {
        const header = `| ${block.header.map((cell) => inlineHtmlToMarkdown(cell).trim()).join(" | ")} |`;
        const alignments = `| ${block.alignments.map(alignmentToMarkdown).join(" | ")} |`;
        const rows = block.rows.map(
          (row) => `| ${row.map((cell) => inlineHtmlToMarkdown(cell).trim()).join(" | ")} |`,
        );
        parts.push([header, alignments, ...rows].join("\n"));
        break;
      }
      case "code":
        parts.push(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
        break;
      case "image": {
        const title = block.title ? ` "${block.title}"` : "";
        parts.push(`![${block.alt}](${block.src}${title})`);
        break;
      }
      case "hr":
        parts.push("---");
        break;
      case "html":
        parts.push(block.source.trimEnd());
        break;
      case "callout": {
        const body = inlineHtmlToMarkdown(block.html).trim();
        parts.push(`> [!CALLOUT icon=${block.icon}]\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`);
        break;
      }
      case "toggle": {
        const body = inlineHtmlToMarkdown(block.html).trim();
        parts.push(`<details${block.open ? " open" : ""}><summary>${block.summary}</summary>\n\n${body}\n\n</details>`);
        break;
      }
    }
    i++;
  }

  return parts.join("\n\n").trim();
}

export function duplicateBlock(block: MarkdownBlock): MarkdownBlock {
  return JSON.parse(JSON.stringify({ ...block, id: createId(block.type) })) as MarkdownBlock;
}

export function createDefaultBlock(type: MarkdownBlock["type"]): MarkdownBlock {
  switch (type) {
    case "heading":
      return { id: createId("heading"), type: "heading", level: 2, html: "", depth: 0 };
    case "blockquote":
      return { id: createId("quote"), type: "blockquote", html: "", depth: 0 };
    case "list":
      return {
        id: createId("list"),
        type: "list",
        ordered: false,
        start: 1,
        items: [{ id: createId("li"), depth: 0, ordered: false, checked: null, html: "" }],
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
    case "callout":
      return { id: createId("callout"), type: "callout", icon: "💡", html: "" };
    case "toggle":
      return { id: createId("toggle"), type: "toggle", summary: "Toggle", html: "", open: false };
    case "paragraph":
      return { id: createId("p"), type: "paragraph", html: "", depth: 0 };
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
    ordered: current.ordered,
    checked: current.checked,
    html: afterHtml,
  });
  return { ...block, items };
}

export function splitTextBlock(
  block: Extract<MarkdownBlock, { type: "paragraph" | "blockquote" | "heading" }>,
  beforeHtml: string,
  afterHtml: string,
): {
  current: Extract<MarkdownBlock, { type: "paragraph" | "blockquote" | "heading" }>;
  next: Extract<MarkdownBlock, { type: "paragraph" | "blockquote" | "heading" }>;
} {
  switch (block.type) {
    case "heading":
      return {
        current: { ...block, html: beforeHtml },
        next: { id: createId("heading"), type: "heading", level: block.level, html: afterHtml, depth: block.depth },
      };
    case "blockquote":
      return {
        current: { ...block, html: beforeHtml },
        next: { id: createId("quote"), type: "blockquote", html: afterHtml, depth: block.depth },
      };
    case "paragraph":
      return {
        current: { ...block, html: beforeHtml },
        next: { id: createId("p"), type: "paragraph", html: afterHtml, depth: block.depth },
      };
  }
}

export function removeListItem(block: Extract<MarkdownBlock, { type: "list" }>, itemIndex: number) {
  const items = block.items.filter((_, index) => index !== itemIndex);
  if (items.length === 0) {
    items.push({ id: createId("li"), depth: 0, ordered: false, checked: null, html: "" });
  }
  return { ...block, items };
}

export function indentBlock(block: Extract<MarkdownBlock, { type: "paragraph" | "heading" | "blockquote" }>) {
  return { ...block, depth: Math.min(block.depth + 1, 6) };
}

export function outdentBlock(block: Extract<MarkdownBlock, { type: "paragraph" | "heading" | "blockquote" }>) {
  return { ...block, depth: Math.max(block.depth - 1, 0) };
}

export function normalizeBlockHtml(block: MarkdownBlock): MarkdownBlock {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
      return { ...block, html: stripOuterParagraph(block.html) };
    case "heading":
      return { ...block, html: stripOuterParagraph(block.html) };
    case "callout":
    case "toggle":
      return { ...block, html: stripOuterParagraph(block.html) };
    default:
      return block;
  }
}
