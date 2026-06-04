import { describe, expect, it } from "vitest";
import {
  addTableColumn,
  addTableRow,
  indentListItem,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  outdentListItem,
  parseMarkdownToBlocks,
  removeTableColumn,
  removeTableRow,
  serializeBlocksToMarkdown,
  splitTextBlock,
  toggleTableHeader,
  updateTableColumnAlignment,
} from "./index";

describe("markdown model", () => {
  it("round-trips common markdown blocks into canonical markdown", () => {
    const markdown = [
      "# Heading",
      "",
      "Paragraph with **bold** and *italic* and [link](https://example.com).",
      "",
      "- [ ] one",
      "- [x] two",
      "",
      "| Name | Role |",
      "| --- | :---: |",
      "| Kaya | Editor |",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(markdown);
    const result = serializeBlocksToMarkdown(blocks);

    expect(result).toContain("# Heading");
    expect(result).toContain("**bold**");
    expect(result).toContain("- [ ] one");
    expect(result).toContain("| Name | Role |");
    expect(result).toContain("```ts");
  });

  it("parses tables with alignment metadata", () => {
    const blocks = parseMarkdownToBlocks([
      "| Left | Center | Right |",
      "| :--- | :---: | ---: |",
      "| a | b | c |",
    ].join("\n"));

    expect(blocks[0]).toMatchObject({
      type: "table",
      alignments: ["left", "center", "right"],
    });
  });

  it("serializes inline html back to markdown", () => {
    const html = 'hello <strong>world</strong> <a href="https://example.com">link</a> <code>x</code>';
    expect(inlineHtmlToMarkdown(html)).toBe("hello **world** [link](https://example.com) `x`");
    expect(inlineMarkdownToHtml("**world**")).toBe("<strong>world</strong>");
  });

  it("updates table structure helpers", () => {
    const [table] = parseMarkdownToBlocks([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n"));

    if (table.type !== "table") {
      throw new Error("Expected a table block.");
    }

    const withRow = addTableRow(table, 1);
    expect(withRow.rows).toHaveLength(2);

    const withColumn = addTableColumn(withRow, 1);
    expect(withColumn.header).toHaveLength(3);

    const aligned = updateTableColumnAlignment(withColumn, 1, "center");
    expect(aligned.alignments[1]).toBe("center");

    const swapped = toggleTableHeader(aligned);
    expect(swapped.header[0]).toBe("1");

    const withoutRow = removeTableRow(swapped, 0);
    expect(withoutRow.rows.length).toBeGreaterThan(0);

    const withoutColumn = removeTableColumn(withoutRow, 0);
    expect(withoutColumn.header.length).toBeGreaterThan(0);
  });

  it("indents and outdents list items", () => {
    const [first, second] = parseMarkdownToBlocks([
      "- one",
      "- two",
    ].join("\n"));

    if (first.type !== "list" || second.type !== "list") {
      throw new Error("Expected two list blocks.");
    }

    const indented = indentListItem(second, 0);
    expect(indented.items[0].depth).toBe(1);

    const outdented = outdentListItem(indented, 0);
    expect(outdented.items[0].depth).toBe(0);
  });

  it("splits text blocks without changing their block type", () => {
    const [paragraph, heading, quote] = parseMarkdownToBlocks([
      "Hello world",
      "",
      "## Section title",
      "",
      "> Quoted text",
    ].join("\n"));

    if (paragraph.type !== "paragraph" || heading.type !== "heading" || quote.type !== "blockquote") {
      throw new Error("Expected text-like blocks.");
    }

    expect(splitTextBlock(paragraph, "Hello", "world")).toMatchObject({
      current: { type: "paragraph", html: "Hello" },
      next: { type: "paragraph", html: "world" },
    });
    expect(splitTextBlock(heading, "Section", "title")).toMatchObject({
      current: { type: "heading", level: 2, html: "Section" },
      next: { type: "heading", level: 2, html: "title" },
    });
    expect(splitTextBlock(quote, "Quoted", "text")).toMatchObject({
      current: { type: "blockquote", html: "Quoted" },
      next: { type: "blockquote", html: "text" },
    });
  });

  it("round-trips mixed ordered and unordered nested lists", () => {
    const markdown = [
      "1. Parent",
      "    - Child bullet",
      "    - Child bullet two",
      "2. Second parent",
      "- Root bullet",
      "    1. Ordered child",
      "    2. Ordered child two",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(markdown);
    expect(serializeBlocksToMarkdown(blocks)).toBe(markdown);
  });

  it("parses star bullets as lists", () => {
    const blocks = parseMarkdownToBlocks([
      "* one",
      "* two",
    ].join("\n"));

    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type === "list" && b.items[0].ordered === false)).toBe(true);
  });

  it("treats tab indentation as nested list depth", () => {
    const [, child] = parseMarkdownToBlocks([
      "- parent",
      "	* child",
    ].join("\n"));

    if (child.type !== "list") {
      throw new Error("Expected a list block.");
    }

    expect(child.items[0]).toMatchObject({ depth: 1, ordered: false });
  });
});
