"use client";

import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { MarkdownBlock } from "@kaya/markdown-model";
import { blockLabel } from "./utils/helpers";

export function BlockShell({
  block,
  index,
  active,
  selected,
  children,
  onActivate,
  onDelete,
  onDuplicate,
  onGutterMouseDown,
  onGutterMouseEnter,
  onDragStart,
  onDragEnd,
  onDragOverBlock,
  onDrop,
  showDropBefore,
  showDropAfter,
  isDragging,
  menuOpen,
  onMenuToggle,
}: {
  block: MarkdownBlock;
  index: number;
  active: boolean;
  selected: boolean;
  children: ReactNode;
  onActivate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onGutterMouseDown: () => void;
  onGutterMouseEnter: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverBlock: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  showDropBefore: boolean;
  showDropAfter: boolean;
  isDragging: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isFirstMountRef = useRef(true);
  const [justMounted, setJustMounted] = useState(true);

  useEffect(() => {
    const reset = () => setHovered(false);
    document.addEventListener("dragend", reset);
    return () => document.removeEventListener("dragend", reset);
  }, []);

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      const t = window.setTimeout(() => setJustMounted(false), 140);
      return () => window.clearTimeout(t);
    }
  }, []);

  const handleVisible = hovered || active || menuOpen;
  const handleOpacity = handleVisible ? "opacity-100" : "opacity-0 pointer-events-none";

  return (
    <div
      data-block-id={block.id}
      role="group"
      aria-label={`${blockLabel(block)} block`}
      className={`relative ${active ? "z-10" : ""} ${justMounted ? "kaya-block-enter" : ""}`}
      style={{ paddingLeft: "2.5rem" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onActivate}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOverBlock(event);
      }}
    >
      {showDropBefore && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center" style={{ paddingLeft: "2.5rem" }}>
          <div className="h-1 w-full bg-[var(--color-accent)] shadow-[0_0_0_2px_black]" />
        </div>
      )}

      <div
        className="absolute inset-y-0 left-0 w-12 cursor-pointer"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onGutterMouseDown(); }}
        onMouseEnter={onGutterMouseEnter}
      />
      <div
        className={`absolute flex flex-col gap-1 transition-opacity duration-150 ${handleOpacity}`}
        style={{ left: "8px", top: "4px" }}
      >
        <div className="relative">
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              const blockEl = (e.currentTarget.closest("[data-block-id]") as HTMLElement | null);
              if (blockEl) {
                const clone = blockEl.cloneNode(true) as HTMLElement;
                clone.style.position = "absolute";
                clone.style.top = "-9999px";
                clone.style.left = "-9999px";
                clone.style.width = `${blockEl.offsetWidth}px`;
                clone.style.opacity = "0.85";
                clone.style.background = "var(--color-surface)";
                clone.style.border = "2px solid black";
                clone.style.borderRadius = "var(--radius-md)";
                clone.style.padding = "4px 8px";
                document.body.appendChild(clone);
                e.dataTransfer.setDragImage(clone, 16, 16);
                window.setTimeout(() => clone.remove(), 0);
              }
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
            aria-label={`Options for ${blockLabel(block)} block ${index + 1}`}
            aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
            className="flex items-center justify-center border border-[var(--color-border-strong)] bg-[var(--color-surface)] font-bold leading-none hover:bg-[var(--color-bg-subtle)]"
            style={{ width: "20px", height: "20px", fontSize: "10px", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" }}
            title={`Options for ${blockLabel(block)} block ${index + 1}`}
          >
            ⋮⋮
          </button>
          {menuOpen && (
            <div
              className="absolute left-10 top-0 z-30 min-w-36 border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
              style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => { onDuplicate(); onMenuToggle(); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-medium hover:bg-[var(--color-bg-subtle)]"
              >
                Duplicate
              </button>
              <div className="mx-2 border-t border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => { onDelete(); onMenuToggle(); }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-bg-subtle)]"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={`border-l-2 pl-2 transition-[border-color,background-color,opacity] ${selected ? "border-l-[var(--color-accent)] bg-[var(--color-accent)]/10" : active ? "border-l-[var(--color-accent)]" : "border-l-transparent"} ${isDragging ? "opacity-45" : "opacity-100"}`}
      >
        {children}
      </div>

      {showDropAfter && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center" style={{ paddingLeft: "2.5rem" }}>
          <div className="h-1 w-full bg-[var(--color-accent)] shadow-[0_0_0_2px_black]" />
        </div>
      )}
    </div>
  );
}
