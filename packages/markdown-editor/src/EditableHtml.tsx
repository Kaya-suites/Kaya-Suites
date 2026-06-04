"use client";

import { type FocusEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef } from "react";
import { useEditorContext } from "./EditorContext";
import { sanitizeInlineHtml } from "./sanitize";
import { captureOffsetWithin, restoreOffsetWithin } from "./selection";
import { tryInlineShortcut } from "./utils/inlineShortcuts";

export function EditableHtml({
  html,
  className,
  tagName = "div",
  onFocus,
  onChange,
  onKeyDown,
  onMouseUp,
  onKeyUp,
  registerRef,
  dataBlockId,
  dataItemId,
  ariaLabel,
}: {
  html: string;
  className: string;
  tagName?: "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  onChange: (html: string, text: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMouseUp?: () => void;
  onKeyUp?: () => void;
  registerRef?: (node: HTMLDivElement | null) => void;
  dataBlockId?: string;
  dataItemId?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useEditorContext();

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sanitized = sanitizeInlineHtml(html);
    if (node.innerHTML === sanitized) return;
    const offsets = captureOffsetWithin(node);
    node.innerHTML = sanitized;
    if (offsets) restoreOffsetWithin(node, offsets);
  }, [html]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handler = (event: Event) => {
      const ie = event as InputEvent;
      if (ie.inputType === "historyUndo") {
        event.preventDefault();
        editor.undo();
      } else if (ie.inputType === "historyRedo") {
        event.preventDefault();
        editor.redo();
      }
    };
    node.addEventListener("beforeinput", handler);
    return () => {
      node.removeEventListener("beforeinput", handler);
    };
  }, [editor]);

  const Tag = tagName;

  return (
    <Tag
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-block-id={dataBlockId}
      data-item-id={dataItemId}
      ref={(node: HTMLDivElement | null) => {
        ref.current = node;
        registerRef?.(node);
      }}
      className={className}
      onFocus={onFocus}
      onCompositionStart={() => {
        editor.setComposing(true);
      }}
      onCompositionEnd={(event) => {
        editor.setComposing(false);
        const node = event.currentTarget;
        const safe = sanitizeInlineHtml(node.innerHTML);
        onChange(safe, node.textContent ?? "");
      }}
      onInput={(event) => {
        if (editor.isComposing()) return;
        const node = event.currentTarget;
        const nativeEvent = event.nativeEvent as InputEvent;
        const inputType = nativeEvent.inputType ?? "";
        if (
          inputType === "insertText" ||
          inputType === "insertCompositionText" ||
          inputType === "insertFromPaste" ||
          inputType === ""
        ) {
          if (tryInlineShortcut(node)) {
            const safe = sanitizeInlineHtml(node.innerHTML);
            onChange(safe, node.textContent ?? "");
            return;
          }
        }
        const safe = sanitizeInlineHtml(node.innerHTML);
        onChange(safe, node.textContent ?? "");
      }}
      onKeyDown={onKeyDown}
      onMouseUp={onMouseUp}
      onKeyUp={onKeyUp}
    />
  );
}
