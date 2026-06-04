"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, FileText, Settings, LayoutGrid, LogOut, ChevronLeft, ChevronRight } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const navItems = [
  { href: "/chat", label: "Chat", icon: <MessageSquare size={15} /> },
  { href: "/documents", label: "Docs", icon: <FileText size={15} /> },
  { href: "/settings", label: "Settings", icon: <Settings size={15} /> },
];

async function logout() {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  window.location.href = "/";
}

const CollapseIcon = ({ direction }: { direction: "left" | "right" }) =>
  direction === "left" ? <ChevronLeft size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />;

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
      .then((r) => r.ok ? r.json() : null)
      .then((u) => { if (u?.is_superadmin) setIsSuperadmin(true); })
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
        className="flex flex-col shrink-0 min-h-screen border-r-2 border-black items-center pt-4"
        style={{ width: "2.5rem", background: "var(--color-background)" }}
      >
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          className="w-8 h-8 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          style={{ boxShadow: "var(--shadow-button)" }}
        >
          <CollapseIcon direction="right" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col shrink-0 min-h-screen border-r-2 border-black"
      style={{ width: "var(--nav-width)", background: "var(--color-background)" }}
    >
      <div className="px-4 py-4 border-b-2 border-black flex items-center justify-between gap-2">
        <Link
          href="/"
          className="font-bold text-xs tracking-wider text-black uppercase hover:text-[var(--color-accent)] transition-colors truncate"
        >
          Kaya Suites
        </Link>
        <button
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          className="shrink-0 w-8 h-8 flex items-center justify-center border-2 border-black bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          style={{ boxShadow: "var(--shadow-button)" }}
        >
          <CollapseIcon direction="left" />
        </button>
      </div>

      <nav className="flex-1 py-3 space-y-1 px-2">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-2 py-2 text-xs font-bold uppercase tracking-wider transition-all border-2 ${
                active
                  ? "bg-[var(--color-accent)] text-white border-black"
                  : "border-transparent text-black hover:border-black hover:bg-[var(--color-muted-bg)]"
              }`}
              style={active ? { boxShadow: "var(--shadow-button)" } : {}}
            >
              {icon}
              {label}
            </Link>
          );
        })}

        {isSuperadmin && (
          <>
            <div className="mx-2 my-2 border-t border-black/20" />
            <Link
              href="/admin"
              className={`flex items-center gap-2.5 px-2 py-2 text-xs font-bold uppercase tracking-wider transition-all border-2 ${
                pathname === "/admin" || pathname.startsWith("/admin/")
                  ? "bg-[var(--color-accent)] text-white border-black"
                  : "border-transparent text-black hover:border-black hover:bg-[var(--color-muted-bg)]"
              }`}
              style={pathname.startsWith("/admin") ? { boxShadow: "var(--shadow-button)" } : {}}
            >
              <LayoutGrid size={15} />
              Admin
            </Link>
          </>
        )}
      </nav>

      <div className="border-t-2 border-black p-2">
        <button
          onClick={logout}
          className="flex items-center gap-2.5 w-full px-2 py-2 border-2 border-transparent text-xs font-bold uppercase tracking-wider text-[var(--color-muted)] hover:border-black hover:text-black hover:bg-[var(--color-muted-bg)] transition-all"
        >
          <LogOut size={15} />
          Log out
        </button>
      </div>
    </aside>
  );
}
