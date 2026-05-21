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
  toggleTableHeader,
  updateTableColumnAlignment,
} from "./model";

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
    const [list] = parseMarkdownToBlocks([
      "- one",
      "- two",
    ].join("\n"));

    if (list.type !== "list") {
      throw new Error("Expected a list block.");
    }

    const indented = indentListItem(list, 1);
    expect(indented.items[1].depth).toBe(1);

    const outdented = outdentListItem(indented, 1);
    expect(outdented.items[1].depth).toBe(0);
  });
});
