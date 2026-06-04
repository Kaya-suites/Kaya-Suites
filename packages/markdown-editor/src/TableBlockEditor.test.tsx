import { type MutableRefObject, type ReactElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDefaultBlock, type MarkdownBlock } from "@kaya/markdown-model";
import { EditorContextProvider } from "./EditorContext";
import { TableBlockEditor } from "./TableBlockEditor";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  private readonly elements = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  static trigger(element: Element) {
    for (const observer of MockResizeObserver.instances) {
      if (!observer.elements.has(element)) continue;
      observer.callback([{ target: element } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    }
  }
}

const composingRef = { current: false } as MutableRefObject<boolean>;
let root: Root | null = null;
let clientWidthDescriptor: PropertyDescriptor | undefined;

function renderWithEditor(element: ReactElement, stickyTopOffset = 0) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <EditorContextProvider
        composingRef={composingRef}
        undo={() => {}}
        redo={() => {}}
        stickyTopOffset={stickyTopOffset}
      >
        {element}
      </EditorContextProvider>,
    );
  });
  return container;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function mouseEnter(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

function setRect(element: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
        top: rect.top ?? 0,
        right: rect.right ?? ((rect.left ?? 0) + (rect.width ?? 0)),
        bottom: rect.bottom ?? ((rect.top ?? 0) + (rect.height ?? 0)),
        left: rect.left ?? 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

describe("TableBlockEditor", () => {
  beforeAll(() => {
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        const value = (this as HTMLElement).dataset.testWidth;
        return value ? Number(value) : 0;
      },
    });
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    MockResizeObserver.instances = [];
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    document.body.innerHTML = "";
  });

  it("renders semantic table structure with sticky header cells", () => {
    const block = createDefaultBlock("table") as Extract<MarkdownBlock, { type: "table" }>;
    const container = renderWithEditor(
      <TableBlockEditor block={block} onFocus={() => {}} onChange={() => {}} />,
      64,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("colgroup")).not.toBeNull();
    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelector("tbody")).not.toBeNull();

    const stickyHeader = container.querySelector<HTMLElement>("[data-sticky-header='true']");
    expect(stickyHeader?.style.position).toBe("");

    const scrollContainer = container.querySelector<HTMLElement>("[data-table-scroll-container='true']");
    const headerRow = container.querySelector<HTMLElement>("thead tr");
    setRect(scrollContainer!, { top: 32, bottom: 540, height: 508 });
    setRect(headerRow!, { top: 32, bottom: 84, height: 52 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(stickyHeader?.style.position).toBe("sticky");
    expect(stickyHeader?.style.top).toBe("64px");
  });

  it("switches between fit and overflow width modes based on container width", () => {
    const block = createDefaultBlock("table") as Extract<MarkdownBlock, { type: "table" }>;
    const container = renderWithEditor(
      <TableBlockEditor block={block} onFocus={() => {}} onChange={() => {}} />,
      0,
    );

    const scrollContainer = container.querySelector<HTMLElement>("[data-table-scroll-container='true']");
    const table = container.querySelector<HTMLElement>("table");
    expect(scrollContainer).not.toBeNull();
    expect(table).not.toBeNull();

    scrollContainer!.dataset.testWidth = "600";
    act(() => {
      MockResizeObserver.trigger(scrollContainer!);
    });
    expect(scrollContainer?.dataset.widthMode).toBe("fit");
    expect(table?.style.width).toBe("600px");

    scrollContainer!.dataset.testWidth = "300";
    act(() => {
      MockResizeObserver.trigger(scrollContainer!);
    });
    expect(scrollContainer?.dataset.widthMode).toBe("overflow");
    expect(table?.style.width).toBe("360px");
  });

  it("supports contextual row and column controls while preserving normalized sizing", () => {
    function Harness() {
      const [block, setBlock] = useState(createDefaultBlock("table") as Extract<MarkdownBlock, { type: "table" }>);
      return <TableBlockEditor block={block} onFocus={() => {}} onChange={setBlock} />;
    }

    const container = renderWithEditor(<Harness />);
    const resizeHandle = container.querySelector<HTMLElement>("[aria-label='Resize column']");
    expect(resizeHandle).not.toBeNull();

    act(() => {
      resizeHandle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 70 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 70 }));
    });

    const headerCells = container.querySelectorAll("th");
    mouseEnter(headerCells[0]!);
    click(container.querySelector("[aria-label='Insert column right']")!);

    let cols = Array.from(container.querySelectorAll<HTMLTableColElement>("colgroup col"));
    let bodyRows = container.querySelectorAll("tbody tr");
    expect(cols).toHaveLength(3);
    expect(cols[0]?.style.width).toBe("250px");
    expect(cols[2]?.style.width).toBe("180px");
    expect(bodyRows[0]?.querySelectorAll("td")).toHaveLength(3);

    const firstRowCells = container.querySelectorAll("tbody tr:first-child td");
    mouseEnter(firstRowCells[0]!);
    click(container.querySelector("[aria-label='Insert row below']")!);

    bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    const secondRowTextarea = bodyRows[1]?.querySelector<HTMLTextAreaElement>("textarea");
    expect(secondRowTextarea?.style.minHeight).toBe("52px");

    const secondRowFirstCell = bodyRows[1]?.querySelector("td");
    mouseEnter(secondRowFirstCell!);
    click(container.querySelector("[aria-label='Delete row']")!);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);

    const updatedHeaderCells = container.querySelectorAll("th");
    mouseEnter(updatedHeaderCells[1]!);
    click(container.querySelector("[aria-label='Delete column']")!);

    cols = Array.from(container.querySelectorAll<HTMLTableColElement>("colgroup col"));
    const remainingRow = container.querySelector("tbody tr");
    expect(cols).toHaveLength(2);
    expect(remainingRow?.querySelectorAll("td")).toHaveLength(2);
  });
});
