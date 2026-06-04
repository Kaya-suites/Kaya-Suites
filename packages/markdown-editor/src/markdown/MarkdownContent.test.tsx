import { type MutableRefObject, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorContextProvider } from "../EditorContext";
import { MarkdownContent } from "./MarkdownContent";

const composingRef = { current: false } as MutableRefObject<boolean>;
let root: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderWithEditor(markdown: string, stickyTopOffset: number) {
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
        <MarkdownContent markdown={markdown} />
      </EditorContextProvider>,
    );
  });
  return container;
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

describe("MarkdownContent tables", () => {
  beforeEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    document.body.innerHTML = "";
  });

  it("renders sticky table headers inside an overflow wrapper", () => {
    const container = renderWithEditor(
      "| Name | Role |\n| --- | --- |\n| Kaya | Host |",
      72,
    );

    const wrapper = container.querySelector("div.overflow-x-auto");
    const stickyHeader = container.querySelector<HTMLElement>("[data-sticky-header='true']");
    const headerRow = container.querySelector<HTMLElement>("thead tr");

    expect(wrapper).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
    expect(stickyHeader?.style.position).toBe("");

    setRect(wrapper!, { top: 40, bottom: 420, height: 380 });
    setRect(headerRow!, { top: 40, bottom: 88, height: 48 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(stickyHeader?.style.position).toBe("sticky");
    expect(stickyHeader?.style.top).toBe("72px");
  });
});
