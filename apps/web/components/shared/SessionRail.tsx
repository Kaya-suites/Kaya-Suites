"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSession } from "@/types/chat";
import { MoreVertical, Pencil, Pin, Trash2, ChevronLeft, ChevronRight, Plus, AlignJustify, Rows3 } from "lucide-react";

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

const iconBtn = "p-1.5 border-2 border-transparent hover:border-black hover:bg-[var(--color-muted-bg)] transition-all text-black";

// ── Kebab menu ────────────────────────────────────────────────────────────────

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

  const textColor = isActive ? "text-white" : "text-[var(--color-muted)]";
  const menuBg = "bg-[var(--color-background)] border-2 border-black";
  const menuItem =
    "flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs font-mono text-black hover:bg-[var(--color-muted-bg)] transition-colors";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`opacity-0 group-hover:opacity-100 ${open ? "opacity-100" : ""} p-1.5 transition-opacity ${textColor}`}
        title="Options"
        aria-label="Session options"
      >
        <MoreVertical size={12} />
      </button>

      {open && (
        <div
          className={`absolute right-0 top-full mt-0.5 z-50 w-36 ${menuBg}`}
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          <button className={menuItem} onClick={handleRename}>
            <Pencil size={11} />
            Rename
          </button>
          <button className={menuItem} onClick={handlePin}>
            <Pin size={11} />
            {session.pinned ? "Unpin" : "Pin"}
          </button>
          <div className="border-t border-black/10 my-0.5" />
          <button
            className={`${menuItem} text-red-600 hover:bg-red-50`}
            onClick={handleDelete}
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SessionRail({ sessions, currentSessionId, onSelect, onNew, onRename, onDelete, onPin }: Props) {
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
        className="flex flex-col items-center w-10 min-h-0 border-r-2 border-black py-3 gap-3 shrink-0"
        style={{ background: "var(--color-background)" }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sessions"
          className="w-8 h-8 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          style={{ boxShadow: "var(--shadow-button)" }}
        >
          <ChevronRight size={14} />
        </button>
        <button onClick={onNew} className={iconBtn} title="New conversation">
          <Plus size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col w-56 min-h-0 border-r-2 border-black shrink-0"
      style={{ background: "var(--color-background)" }}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b-2 border-black">
        <span className="text-xs font-bold text-black uppercase tracking-wider font-mono">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode(viewMode === "comfortable" ? "compact" : "comfortable")}
            className={iconBtn}
            title={viewMode === "comfortable" ? "Compact view" : "Comfortable view"}
          >
            {viewMode === "comfortable" ? <AlignJustify size={14} /> : <Rows3 size={14} />}
          </button>
          <button onClick={onNew} className={iconBtn} title="New conversation">
            <Plus size={14} />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sessions"
            className="w-8 h-8 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
            style={{ boxShadow: "var(--shadow-button)" }}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 && (
          <p className="px-3 py-2 text-xs text-[var(--color-muted)] font-mono italic">No past sessions</p>
        )}
        {sessions.map((s, i) => {
          const isActive = s.id === currentSessionId;
          const isEditing = editingId === s.id;

          if (viewMode === "compact") {
            return (
              <div
                key={s.id ?? i}
                className={`group flex items-center mx-1 border-2 transition-all ${
                  isActive
                    ? "bg-[var(--color-accent)] text-white border-black"
                    : "border-transparent text-black hover:border-black hover:bg-[var(--color-muted-bg)]"
                }`}
                style={isActive ? { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" } : { borderRadius: "var(--border-radius)" }}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(s.id)}
                    onKeyDown={(e) => handleEditKey(e, s.id)}
                    className="flex-1 px-3 py-1.5 text-xs bg-transparent outline-none font-mono text-black"
                  />
                ) : (
                  <button
                    onClick={() => onSelect(s.id)}
                    className="flex-1 text-left px-3 py-1.5 text-xs truncate leading-5 font-mono font-bold"
                  >
                    {s.pinned && <Pin className="inline mr-1 mb-0.5 opacity-60" size={9} fill="currentColor" />}
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
            <div
              key={s.id ?? i}
              className={`group flex items-start mx-1 border-2 mb-1 transition-all ${
                isActive
                  ? "bg-[var(--color-accent)] text-white border-black"
                  : "border-transparent text-black hover:border-black hover:bg-[var(--color-muted-bg)]"
              }`}
              style={isActive ? { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" } : { borderRadius: "var(--border-radius)" }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(s.id)}
                  onKeyDown={(e) => handleEditKey(e, s.id)}
                  className="flex-1 px-3 py-2 text-sm bg-transparent outline-none font-mono text-black"
                />
              ) : (
                <button
                  onClick={() => onSelect(s.id)}
                  className="flex-1 text-left px-3 py-2 min-w-0"
                >
                  <div className="truncate leading-5 text-xs font-bold font-mono">
                    {s.pinned && <Pin className="inline mr-1 mb-0.5 opacity-60" size={9} fill="currentColor" />}
                    {s.title}
                  </div>
                  <div className={`text-xs mt-0.5 font-mono ${isActive ? "text-white/70" : "text-[var(--color-muted)]"}`}>
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
