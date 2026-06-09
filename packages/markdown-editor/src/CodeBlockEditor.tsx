"use client";

import type { MarkdownBlock } from "@kaya/markdown-model";
import { MermaidDiagram } from "./markdown/MermaidDiagram";
import { CODE_LANGUAGE_OPTIONS } from "./constants";

export function CodeBlockEditor({
  block,
  onFocus,
  onChange,
}: {
  block: Extract<MarkdownBlock, { type: "code" }>;
  onFocus: () => void;
  onChange: (next: Extract<MarkdownBlock, { type: "code" }>) => void;
}) {
  return (
    <div className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]" style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2">
        <select
          value={block.language}
          onFocus={onFocus}
          onChange={(event) => onChange({ ...block, language: event.target.value })}
          className="w-48 border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium"
          style={{ borderRadius: "var(--radius-md)", boxShadow: "none" }}
        >
          {CODE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value || "plain"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] font-medium tracking-[0.18em] text-[var(--color-text-muted)]">
          {block.language.toLowerCase() === "mermaid" ? "Mermaid Preview Enabled" : "Syntax Highlighted In View Mode"}
        </span>
      </div>
      <textarea
        value={block.code}
        onFocus={onFocus}
        onChange={(event) => onChange({ ...block, code: event.target.value })}
        rows={10}
        className="w-full resize-y bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] outline-none"
      />
      {block.language.toLowerCase() === "mermaid" && block.code.trim() && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <MermaidDiagram code={block.code} className="overflow-auto" />
        </div>
      )}
    </div>
  );
}
