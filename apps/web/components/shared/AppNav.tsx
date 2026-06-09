"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const navItems = [
  { href: "/chat", label: "Chat", Icon: MessageSquare },
  { href: "/documents", label: "Docs", Icon: FileText },
  { href: "/settings", label: "Settings", Icon: Settings },
];

async function logout() {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  window.location.href = "/";
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

const itemClass =
  "flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-md)] " +
  "text-[var(--font-size-sm)] font-medium transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]";

export function AppNav() {
  const pathname = usePathname();
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("kaya-nav-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.is_superadmin) setIsSuperadmin(true);
      })
      .catch(() => {});
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("kaya-nav-collapsed", String(next));
      return next;
    });
  }

  if (collapsed) {
    return (
      <aside
        className="flex flex-col shrink-0 min-h-screen items-center pt-4 w-10 border-r border-[var(--color-border)] bg-[var(--color-surface)]"
        aria-label="Primary navigation (collapsed)"
      >
        <button
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
          className="w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          <ChevronRight size={14} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col shrink-0 min-h-screen border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ width: "var(--nav-width)" }}
      aria-label="Primary navigation"
    >
      <div className="px-4 py-4 flex items-center justify-between gap-2 border-b border-[var(--color-border)]">
        <Link
          href="/"
          className="font-[var(--font-serif)] text-base font-semibold tracking-tight text-[var(--color-text)] hover:text-[var(--color-text-muted)] transition-colors truncate"
        >
          Kaya Suites
        </Link>
        <button
          onClick={toggleCollapsed}
          aria-label="Collapse sidebar"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {navItems.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemClass,
                active
                  ? "bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]",
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          );
        })}

        {isSuperadmin && (
          <>
            <div className="mx-2 my-3 border-t border-[var(--color-border)]" />
            <Link
              href="/admin"
              aria-current={isActive(pathname, "/admin") ? "page" : undefined}
              className={cn(
                itemClass,
                isActive(pathname, "/admin")
                  ? "bg-[var(--color-bg-subtle)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]",
              )}
            >
              <LayoutGrid size={15} />
              Admin
            </Link>
          </>
        )}
      </nav>

      <div className="border-t border-[var(--color-border)] p-2 space-y-2">
        <div className="px-1">
          <ThemeToggle />
        </div>
        <button
          onClick={logout}
          className={cn(
            itemClass,
            "w-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]",
          )}
        >
          <LogOut size={15} />
          Log out
        </button>
      </div>
    </aside>
  );
}
