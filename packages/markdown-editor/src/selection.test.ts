import { beforeEach, describe, expect, it } from "vitest";
import { captureSelection, restoreSelection, type EditorSelection } from "./selection";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html.trim();
  document.body.appendChild(root);
  return root;
}

function placeCaret(node: Node, offset: number): void {
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection");
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeRange(start: [Node, number], end: [Node, number]): void {
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection");
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("selection contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("captures a collapsed caret inside a paragraph block", () => {
    const root = mount(`<div data-block-id="b1"><p>hello world</p></div>`);
    const textNode = root.querySelector("p")!.firstChild!;
    placeCaret(textNode, 5);
    const sel = captureSelection(root);
    expect(sel).toEqual({
      anchor: { blockId: "b1", itemId: undefined, offset: 5 },
      focus: { blockId: "b1", itemId: undefined, offset: 5 },
    });
  });

  it("round-trips capture → restore for a collapsed caret", () => {
    const root = mount(`<div data-block-id="b1"><p>hello world</p></div>`);
    placeCaret(root.querySelector("p")!.firstChild!, 5);
    const captured = captureSelection(root)!;
    // Simulate a re-render that rewrites the inner HTML.
    root.innerHTML = `<div data-block-id="b1"><p>hello world</p></div>`;
    expect(restoreSelection(root, captured)).toBe(true);
    expect(captureSelection(root)).toEqual(captured);
  });

  it("walks across multiple text nodes to compute the offset", () => {
    const root = mount(`<div data-block-id="b1"><p><b>foo</b> <i>bar</i></p></div>`);
    const iText = root.querySelector("i")!.firstChild!;
    placeCaret(iText, 1);
    const sel = captureSelection(root)!;
    expect(sel.anchor).toEqual({ blockId: "b1", itemId: undefined, offset: 5 });
  });

  it("counts code points, not UTF-16 units, around an emoji", () => {
    const root = mount(`<div data-block-id="b1"><p>👋hi</p></div>`);
    const textNode = root.querySelector("p")!.firstChild!;
    placeCaret(textNode, 2);
    const sel = captureSelection(root)!;
    expect(sel.anchor.offset).toBe(1);
    expect(restoreSelection(root, sel)).toBe(true);
    expect(captureSelection(root)!.anchor.offset).toBe(1);
  });

  it("captures the inner itemId when the cursor is in a list item", () => {
    const root = mount(`
      <div data-block-id="b1">
        <ul>
          <li data-item-id="i1">first</li>
          <li data-item-id="i2">second</li>
        </ul>
      </div>
    `);
    const li2 = root.querySelectorAll("li")[1]!;
    placeCaret(li2.firstChild!, 3);
    const sel = captureSelection(root);
    expect(sel?.anchor).toEqual({ blockId: "b1", itemId: "i2", offset: 3 });
  });

  it("returns null on capture when the selection is outside the root", () => {
    const root = mount(`<div data-block-id="b1"><p>inside</p></div>`);
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    placeCaret(outside.firstChild!, 2);
    expect(captureSelection(root)).toBeNull();
  });

  it("returns false on restore when the target block is missing", () => {
    const root = mount(`<div data-block-id="b1"><p>hello</p></div>`);
    const ghost: EditorSelection = {
      anchor: { blockId: "ghost", offset: 0 },
      focus: { blockId: "ghost", offset: 0 },
    };
    expect(restoreSelection(root, ghost)).toBe(false);
  });

  it("captures a non-collapsed range with distinct anchor and focus offsets", () => {
    const root = mount(`<div data-block-id="b1"><p>hello world</p></div>`);
    const t = root.querySelector("p")!.firstChild!;
    placeRange([t, 0], [t, 5]);
    const sel = captureSelection(root)!;
    expect(sel.anchor.offset).toBe(0);
    expect(sel.focus.offset).toBe(5);
  });

  it("clamps an overshooting offset to the end of the block on restore", () => {
    const root = mount(`<div data-block-id="b1"><p>hi</p></div>`);
    const sel: EditorSelection = {
      anchor: { blockId: "b1", offset: 999 },
      focus: { blockId: "b1", offset: 999 },
    };
    expect(restoreSelection(root, sel)).toBe(true);
    expect(captureSelection(root)!.anchor.offset).toBe(2);
  });
});
