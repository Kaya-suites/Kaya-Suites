"use client";

import { useRef } from "react";

type Props = {
  onSend: (message: string) => void;
  disabled?: boolean;
};

export function ChatInput({ onSend, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const value = textareaRef.current?.value.trim();
    if (!value || disabled) return;
    onSend(value);
    if (textareaRef.current) textareaRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  return (
    <div className="border-t-2 border-black bg-[var(--color-surface)] px-4 py-3">
      <div
        className="flex items-end gap-2 border-2 border-black bg-white px-3 py-2 transition-all focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
      >
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          placeholder="Ask about your documents… (Enter to send)"
          rows={1}
          className="flex-1 resize-none border-none outline-none bg-transparent text-sm text-black placeholder:text-[var(--color-muted)] leading-relaxed py-0.5 disabled:opacity-50 font-mono"
        />
        <button
          onClick={submit}
          disabled={disabled}
          className="shrink-0 mb-0.5 px-3 py-1.5 border-2 border-black bg-[var(--color-accent)] text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50 transition-all hover:translate-[-1px] active:translate-[1px]"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          title="Send"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8l12-6-5 6 5 6-12-6z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-[var(--color-muted)] font-mono">
        KAYA AI · RESPONSES MAY CONTAIN ERRORS. ALWAYS VERIFY CITED SOURCES.
      </p>
    </div>
  );
}
