"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import {
  addTableColumn,
  addTableRow,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  removeTableColumn,
  removeTableRow,
  toggleTableHeader,
  type MarkdownBlock,
} from "@kaya/markdown-model";
import { useEditorContext } from "./EditorContext";
import { ToolbarButton } from "./shared-ui";

const DEFAULT_COLUMN_WIDTH = 180;
const DEFAULT_ROW_HEIGHT = 52;
const MIN_COLUMN_WIDTH = 120;
const MIN_ROW_HEIGHT = 44;

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function normalizeSizes(current: number[], length: number, fallback: number) {
  return Array.from({ length }, (_, index) => current[index] ?? fallback);
}

function tableActionClassName() {
  return "inline-flex h-6 min-w-6 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[10px] font-medium hover:bg-[var(--color-bg-subtle)]";
}

export function TableBlockEditor({
  block,
  onFocus,
  onChange,
}: {
  block: Extract<MarkdownBlock, { type: "table" }>;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "table" }>) => void;
}) {
  const { stickyTopOffset } = useEditorContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [availableTableWidth, setAvailableTableWidth] = useState(0);
  const [stickyActive, setStickyActive] = useState(false);
  const [columnWidths, setColumnWidths] = useState<number[]>(() =>
    Array.from({ length: block.header.length }, () => DEFAULT_COLUMN_WIDTH),
  );
  const [rowHeights, setRowHeights] = useState<number[]>(() =>
    Array.from({ length: block.rows.length + 1 }, () => DEFAULT_ROW_HEIGHT),
  );
  const [hoveredColumnIndex, setHoveredColumnIndex] = useState<number | null>(null);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  useEffect(() => {
    setColumnWidths((current) => normalizeSizes(current, block.header.length, DEFAULT_COLUMN_WIDTH));
  }, [block.header.length]);

  useEffect(() => {
    setRowHeights((current) => normalizeSizes(current, block.rows.length + 1, DEFAULT_ROW_HEIGHT));
  }, [block.rows.length]);

  useEffect(() => {
    setHoveredColumnIndex((current) => {
      if (current == null || current < block.header.length) return current;
      return block.header.length > 0 ? block.header.length - 1 : null;
    });
  }, [block.header.length]);

  useEffect(() => {
    setHoveredRowIndex((current) => {
      if (current == null || current < block.rows.length) return current;
      return block.rows.length > 0 ? block.rows.length - 1 : null;
    });
  }, [block.rows.length]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      setAvailableTableWidth(Math.max(0, node.clientWidth));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const scrollParent = node.closest<HTMLElement>("[data-editor-scroll]");

    const updateStickyState = () => {
      const containerRect = node.getBoundingClientRect();
      const headerHeight = headerRowRef.current?.getBoundingClientRect().height ?? 0;
      const nextSticky =
        containerRect.top <= stickyTopOffset &&
        containerRect.bottom - headerHeight > stickyTopOffset;
      setStickyActive((current) => (current === nextSticky ? current : nextSticky));
    };

    updateStickyState();
    const scrollTarget: HTMLElement | Window = scrollParent ?? window;
    scrollTarget.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);

    return () => {
      scrollTarget.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [stickyTopOffset]);

  const visibleColumnWidths = useMemo(
    () => normalizeSizes(columnWidths, block.header.length, DEFAULT_COLUMN_WIDTH),
    [block.header.length, columnWidths],
  );
  const visibleRowHeights = useMemo(
    () => normalizeSizes(rowHeights, block.rows.length + 1, DEFAULT_ROW_HEIGHT),
    [block.rows.length, rowHeights],
  );

  function beginColumnResize(columnIndex: number, startX: number) {
    const initialWidth = visibleColumnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH;

    function handleMove(event: MouseEvent) {
      const width = Math.max(MIN_COLUMN_WIDTH, initialWidth + event.clientX - startX);
      setColumnWidths((current) => current.map((value, index) => (index === columnIndex ? width : value)));
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function beginRowResize(rowIndex: number, startY: number) {
    const initialHeight = visibleRowHeights[rowIndex] ?? DEFAULT_ROW_HEIGHT;

    function handleMove(event: MouseEvent) {
      const height = Math.max(MIN_ROW_HEIGHT, initialHeight + event.clientY - startY);
      setRowHeights((current) => current.map((value, index) => (index === rowIndex ? height : value)));
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function beginTableResize(startX: number) {
    const initialWidths = [...visibleColumnWidths];
    const initialTotalWidth = initialWidths.reduce((sum, width) => sum + width, 0);

    function handleMove(event: MouseEvent) {
      const nextTotalWidth = Math.max(320, initialTotalWidth + event.clientX - startX);
      const scale = nextTotalWidth / Math.max(initialTotalWidth, 1);
      const resized = initialWidths.map((width) => Math.max(MIN_COLUMN_WIDTH, Math.round(width * scale)));
      setColumnWidths(resized);
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  function updateHeaderCell(columnIndex: number, value: string) {
    onChange({
      ...block,
      header: block.header.map((cell, index) => (index === columnIndex ? inlineMarkdownToHtml(value) : cell)),
    });
  }

  function updateBodyCell(rowIndex: number, columnIndex: number, value: string) {
    onChange({
      ...block,
      rows: block.rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? row.map((cell, currentColumnIndex) =>
              currentColumnIndex === columnIndex ? inlineMarkdownToHtml(value) : cell,
            )
          : row,
      ),
    });
  }

  const totalTableWidth = visibleColumnWidths.reduce((sum, width) => sum + width, 0);
  const isOverflowMode = availableTableWidth > 0 && totalTableWidth > availableTableWidth;
  const displayTableWidth =
    availableTableWidth > 0 && !isOverflowMode ? Math.max(totalTableWidth, availableTableWidth) : totalTableWidth;
  const displayColumnWidths =
    !isOverflowMode && availableTableWidth > 0 && displayTableWidth > totalTableWidth && totalTableWidth > 0
      ? visibleColumnWidths.map((width) => (width / totalTableWidth) * displayTableWidth)
      : visibleColumnWidths;
  const tableStyle = {
    width: `${displayTableWidth}px`,
    minWidth: `${displayTableWidth}px`,
  } satisfies CSSProperties;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-2 border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
        style={{ borderRadius: "var(--radius-md)" }}
      >
        <ToolbarButton title="Add Row" icon={<span className="text-[10px] font-bold">+row</span>} onClick={() => onChange(addTableRow(block, block.rows.length))} />
        <ToolbarButton title="Remove Row" icon={<span className="text-[10px] font-bold">-row</span>} onClick={() => onChange(removeTableRow(block, block.rows.length - 1))} />
        <ToolbarButton title="Add Column" icon={<span className="text-[10px] font-bold">+col</span>} onClick={() => onChange(addTableColumn(block, block.header.length))} />
        <ToolbarButton title="Remove Column" icon={<span className="text-[10px] font-bold">-col</span>} onClick={() => onChange(removeTableColumn(block, block.header.length - 1))} />
        <ToolbarButton title="Toggle Header Row" icon={<ArrowUpDown size={14} />} onClick={() => onChange(toggleTableHeader(block))} />
      </div>

      <div
        ref={containerRef}
        data-table-scroll-container="true"
        data-width-mode={isOverflowMode ? "overflow" : "fit"}
        className="relative overflow-x-auto overflow-y-visible border border-[var(--color-border)] bg-[var(--color-surface)]"
        style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
      >
        <table className="border-separate border-spacing-0" style={tableStyle}>
          <colgroup>
            {displayColumnWidths.map((width, columnIndex) => (
              <col
                key={`${block.id}-col-${columnIndex}`}
                data-column-width={Math.round(width)}
                style={{ width: `${width}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr ref={headerRowRef}>
              {block.header.map((cell, columnIndex) => (
                <th
                  key={`${block.id}-head-${columnIndex}`}
                  data-sticky-header="true"
                  onMouseEnter={() => setHoveredColumnIndex(columnIndex)}
                  onMouseLeave={() => setHoveredColumnIndex((current) => (current === columnIndex ? null : current))}
                  className={`group/column relative border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] align-top ${columnIndex < block.header.length - 1 ? "border-r-2" : ""}`}
                  style={{
                    minHeight: `${visibleRowHeights[0] ?? DEFAULT_ROW_HEIGHT}px`,
                    ...(stickyActive
                      ? {
                          top: `${stickyTopOffset}px`,
                          boxShadow: "inset 0 -2px 0 black, 0 4px 0 rgba(0,0,0,0.04)",
                          position: "sticky",
                          zIndex: 10,
                        }
                      : {}),
                  }}
                >
                  {hoveredColumnIndex === columnIndex && (
                    <div className="absolute right-2 top-0 z-30 flex -translate-y-1/2 items-center gap-1">
                      <button
                        type="button"
                        title="Insert column left"
                        aria-label="Insert column left"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onChange(addTableColumn(block, columnIndex))}
                        className={tableActionClassName()}
                        style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                      >
                        +L
                      </button>
                      <button
                        type="button"
                        title="Insert column right"
                        aria-label="Insert column right"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onChange(addTableColumn(block, columnIndex + 1))}
                        className={tableActionClassName()}
                        style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                      >
                        +R
                      </button>
                      <button
                        type="button"
                        title="Delete column"
                        aria-label="Delete column"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onChange(removeTableColumn(block, columnIndex))}
                        className={tableActionClassName()}
                        style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                      >
                        -C
                      </button>
                    </div>
                  )}
                  <textarea
                    value={inlineHtmlToMarkdown(cell)}
                    placeholder="Column title"
                    rows={1}
                    onFocus={onFocus}
                    ref={(el) => {
                      if (el) autoResizeTextarea(el);
                    }}
                    onChange={(event) => {
                      autoResizeTextarea(event.currentTarget);
                      updateHeaderCell(columnIndex, event.target.value);
                    }}
                    className="block w-full resize-none bg-transparent px-3 py-3 text-sm font-bold outline-none"
                    style={{ minHeight: `${visibleRowHeights[0] ?? DEFAULT_ROW_HEIGHT}px` }}
                  />
                  {columnIndex < block.header.length - 1 && (
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        beginColumnResize(columnIndex, event.clientX);
                      }}
                      className="absolute right-[-7px] top-0 z-20 h-full w-3 cursor-col-resize opacity-0 transition-opacity group-hover/column:opacity-100"
                      title="Resize column"
                      aria-label="Resize column"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr
                key={`${block.id}-row-${rowIndex}`}
                onMouseEnter={() => setHoveredRowIndex(rowIndex)}
                onMouseLeave={() => setHoveredRowIndex((current) => (current === rowIndex ? null : current))}
                className="group/row"
              >
                {row.map((cell, columnIndex) => (
                  <td
                    key={`${block.id}-row-${rowIndex}-col-${columnIndex}`}
                    data-row-index={rowIndex}
                    className={`border-b border-[var(--color-border)] align-top ${columnIndex < row.length - 1 ? "border-r-2" : ""} ${columnIndex === 0 ? "relative" : ""}`}
                    style={{ minHeight: `${visibleRowHeights[rowIndex + 1] ?? DEFAULT_ROW_HEIGHT}px` }}
                  >
                    {columnIndex === 0 && hoveredRowIndex === rowIndex && (
                      <div className="absolute left-2 top-0 z-20 flex -translate-y-1/2 items-center gap-1">
                        <button
                          type="button"
                          title="Insert row above"
                          aria-label="Insert row above"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => onChange(addTableRow(block, rowIndex))}
                          className={tableActionClassName()}
                          style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                        >
                          +A
                        </button>
                        <button
                          type="button"
                          title="Insert row below"
                          aria-label="Insert row below"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => onChange(addTableRow(block, rowIndex + 1))}
                          className={tableActionClassName()}
                          style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                        >
                          +B
                        </button>
                        <button
                          type="button"
                          title="Delete row"
                          aria-label="Delete row"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => onChange(removeTableRow(block, rowIndex))}
                          className={tableActionClassName()}
                          style={{ borderRadius: "calc(var(--radius-md) - 4px)" }}
                        >
                          -R
                        </button>
                      </div>
                    )}
                    <textarea
                      value={inlineHtmlToMarkdown(cell)}
                      placeholder="Empty"
                      rows={1}
                      onFocus={onFocus}
                      ref={(el) => {
                        if (el) autoResizeTextarea(el);
                      }}
                      onChange={(event) => {
                        autoResizeTextarea(event.currentTarget);
                        updateBodyCell(rowIndex, columnIndex, event.target.value);
                      }}
                      className="block w-full resize-none px-3 py-3 text-sm outline-none"
                      style={{ minHeight: `${visibleRowHeights[rowIndex + 1] ?? DEFAULT_ROW_HEIGHT}px` }}
                    />
                    {columnIndex === 0 && (
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          beginRowResize(rowIndex + 1, event.clientY);
                        }}
                        className="absolute bottom-[-7px] left-0 z-10 h-3 w-10 cursor-row-resize opacity-0 transition-opacity group-hover/row:opacity-100"
                        title="Resize row"
                        aria-label="Resize row"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            beginTableResize(event.clientX);
          }}
          className="absolute right-[-7px] top-0 z-20 h-full w-4 cursor-ew-resize"
          title="Resize table width"
          aria-label="Resize table width"
        />
      </div>
    </div>
  );
}
