"use client";

import type { ReactNode } from "react";

export function icon(label: string) {
  return <span className="inline-flex h-5 min-w-5 items-center justify-center border border-black bg-white px-1 text-[10px] font-bold">{label}</span>;
}

export function ToolbarButton({ icon: iconNode, title, onClick, disabled }: { icon: ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center border-2 border-black bg-white disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--color-muted-bg)]"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
    >
      {iconNode}
    </button>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg border-2 border-black bg-[var(--color-surface)] p-4"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b-2 border-black pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wide font-mono">{title}</h3>
          <button onClick={onClose} className="border-2 border-black px-2 py-1 text-xs font-bold uppercase font-mono" style={{ borderRadius: "var(--border-radius)" }}>
            Close
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}
