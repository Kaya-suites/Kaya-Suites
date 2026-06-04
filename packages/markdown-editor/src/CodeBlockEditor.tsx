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
    <div className="overflow-hidden border-2 border-black bg-[var(--color-surface)]" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between gap-3 border-b-2 border-black bg-[var(--color-muted-bg)] px-3 py-2">
        <select
          value={block.language}
          onFocus={onFocus}
          onChange={(event) => onChange({ ...block, language: event.target.value })}
          className="w-48 border-2 border-black bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide font-mono"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
        >
          {CODE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value || "plain"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-muted)] font-mono">
          {block.language.toLowerCase() === "mermaid" ? "Mermaid Preview Enabled" : "Syntax Highlighted In View Mode"}
        </span>
      </div>
      <textarea
        value={block.code}
        onFocus={onFocus}
        onChange={(event) => onChange({ ...block, code: event.target.value })}
        rows={10}
        className="w-full resize-y bg-[var(--color-surface)] px-4 py-3 text-sm font-mono text-black outline-none"
      />
      {block.language.toLowerCase() === "mermaid" && block.code.trim() && (
        <div className="border-t-2 border-black bg-white p-4">
          <MermaidDiagram code={block.code} className="overflow-auto" />
        </div>
      )}
    </div>
  );
}
