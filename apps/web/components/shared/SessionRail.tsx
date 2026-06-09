"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSession } from "@/types/chat";
import {
  AlignJustify,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { cn } from "@/components/ui/cn";

type ViewMode = "comfortable" | "compact";

type Props = {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
};

function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("comfortable");

  useEffect(() => {
    const saved = localStorage.getItem("session-view-mode") as ViewMode | null;
    if (saved === "comfortable" || saved === "compact") setMode(saved);
  }, []);

  function save(m: ViewMode) {
    localStorage.setItem("session-view-mode", m);
    setMode(m);
  }

  return [mode, save];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const iconBtn =
  "inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-md)] " +
  "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

type KebabMenuProps = {
  session: ChatSession;
  isActive: boolean;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onStartEdit: () => void;
};

function KebabMenu({ session, isActive, onDelete, onPin, onStartEdit }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function handleRename(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    onStartEdit();
  }

  function handlePin(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    onPin?.(session.id, !session.pinned);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    onDelete?.(session.id);
  }

  const menuItem =
    "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[var(--font-size-sm)] " +
    "text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "opacity-0 group-hover:opacity-100 p-1.5 transition-opacity",
          open && "opacity-100",
          isActive ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
        )}
        aria-label="Session options"
      >
        <MoreVertical size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1">
          <button className={menuItem} onClick={handleRename}>
            <Pencil size={12} />
            Rename
          </button>
          <button className={menuItem} onClick={handlePin}>
            <Pin size={12} />
            {session.pinned ? "Unpin" : "Pin"}
          </button>
          <div className="border-t border-[var(--color-border)] my-1" />
          <button
            className={cn(menuItem, "text-[var(--color-danger)]")}
            onClick={handleDelete}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionRail({
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onPin,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewMode, setViewMode] = useViewMode();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  function startEdit(s: ChatSession) {
    setEditingId(s.id);
    setEditValue(s.title);
  }

  function commitEdit(id: string) {
    const trimmed = editValue.trim();
    if (trimmed) onRename?.(id, trimmed);
    setEditingId(null);
  }

  function handleEditKey(e: React.KeyboardEvent, id: string) {
    if (e.key === "Enter") commitEdit(id);
    if (e.key === "Escape") setEditingId(null);
  }

  if (collapsed) {
    return (
      <aside
        className="flex flex-col items-center w-10 min-h-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] py-3 gap-2 shrink-0"
        aria-label="Sessions (collapsed)"
      >
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand sessions"
          className={iconBtn}
        >
          <ChevronRight size={14} />
        </button>
        <button onClick={onNew} className={iconBtn} aria-label="New conversation">
          <Plus size={14} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col w-56 min-h-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] shrink-0"
      aria-label="Sessions"
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
        <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-muted)] tracking-wide">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setViewMode(viewMode === "comfortable" ? "compact" : "comfortable")}
            className={iconBtn}
            aria-label={viewMode === "comfortable" ? "Compact view" : "Comfortable view"}
          >
            {viewMode === "comfortable" ? <AlignJustify size={14} /> : <Rows3 size={14} />}
          </button>
          <button onClick={onNew} className={iconBtn} aria-label="New conversation">
            <Plus size={14} />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sessions"
            className={iconBtn}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-[var(--font-size-sm)] text-[var(--color-text-subtle)] italic">
            No past sessions
          </p>
        )}
        {sessions.map((s, i) => {
          const isActive = s.id === currentSessionId;
          const isEditing = editingId === s.id;
          const rowBase =
            "group flex mx-2 mb-0.5 rounded-[var(--radius-md)] transition-colors";
          const rowState = isActive
            ? "bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
            : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]";

          if (viewMode === "compact") {
            return (
              <div key={s.id ?? i} className={cn(rowBase, rowState, "items-center")}>
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(s.id)}
                    onKeyDown={(e) => handleEditKey(e, s.id)}
                    className="flex-1 px-3 py-1.5 text-[var(--font-size-sm)] bg-transparent outline-none text-[var(--color-text)]"
                  />
                ) : (
                  <button
                    onClick={() => onSelect(s.id)}
                    aria-current={isActive ? "true" : undefined}
                    className="flex-1 text-left px-3 py-1.5 text-[var(--font-size-sm)] truncate font-medium"
                  >
                    {s.pinned && (
                      <Pin
                        className="inline mr-1 mb-0.5 opacity-60"
                        size={9}
                        fill="currentColor"
                      />
                    )}
                    {s.title}
                  </button>
                )}
                {!isEditing && (
                  <KebabMenu
                    session={s}
                    isActive={isActive}
                    onRename={onRename}
                    onDelete={onDelete}
                    onPin={onPin}
                    onStartEdit={() => startEdit(s)}
                  />
                )}
              </div>
            );
          }

          return (
            <div key={s.id ?? i} className={cn(rowBase, rowState, "items-start")}>
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(s.id)}
                  onKeyDown={(e) => handleEditKey(e, s.id)}
                  className="flex-1 px-3 py-2 text-[var(--font-size-sm)] bg-transparent outline-none text-[var(--color-text)]"
                />
              ) : (
                <button
                  onClick={() => onSelect(s.id)}
                  aria-current={isActive ? "true" : undefined}
                  className="flex-1 text-left px-3 py-2 min-w-0"
                >
                  <div className="truncate text-[var(--font-size-sm)] font-medium">
                    {s.pinned && (
                      <Pin
                        className="inline mr-1 mb-0.5 opacity-60"
                        size={9}
                        fill="currentColor"
                      />
                    )}
                    {s.title}
                  </div>
                  <div className="text-[var(--font-size-xs)] mt-0.5 text-[var(--color-text-subtle)]">
                    {formatDate(s.updatedAt)}
                  </div>
                </button>
              )}
              {!isEditing && (
                <div className="pt-1.5 pr-1">
                  <KebabMenu
                    session={s}
                    isActive={isActive}
                    onRename={onRename}
                    onDelete={onDelete}
                    onPin={onPin}
                    onStartEdit={() => startEdit(s)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
