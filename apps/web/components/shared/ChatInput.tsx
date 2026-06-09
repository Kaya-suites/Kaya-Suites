"use client";

import { useRef } from "react";
import { Send } from "lucide-react";

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
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-end gap-2 px-3 py-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] transition-colors focus-within:border-[var(--color-text)]">
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          placeholder="Ask about your documents… (Enter to send)"
          rows={1}
          className="flex-1 resize-none border-none outline-none bg-transparent text-[var(--font-size-base)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] leading-relaxed py-0.5 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={disabled}
          aria-label="Send"
          className="shrink-0 mb-0.5 inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          <Send size={14} strokeWidth={1.5} />
        </button>
      </div>
      <p className="mt-2 text-center text-[var(--font-size-xs)] text-[var(--color-text-subtle)]">
        Kaya AI · responses may contain errors. Always verify cited sources.
      </p>
    </div>
  );
}
