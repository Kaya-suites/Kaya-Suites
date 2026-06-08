"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserStats {
  user_id: string;
  email: string;
  monthly_cost_usd: number;
  agent_invocations: number;
}

interface AdminStats {
  aggregate_daily_spend_usd: number;
  aggregate_monthly_spend_usd: number;
  circuit_breaker_active: boolean;
  top_users: UserStats[];
  total_users: number;
  active_subscriptions: number;
}

interface UserRecord {
  id: string;
  email: string;
  username: string | null;
  is_superadmin: boolean;
  created_at: string;
}

interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TableData {
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  page_size: number;
}

interface QueryData {
  columns: string[];
  rows: unknown[][];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(usd: number) {
  return `$${usd.toFixed(4)}`;
}

const cardClass = "bg-[var(--color-surface)] border-2 border-black";
const cardStyle = { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" };

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── Shared result table ───────────────────────────────────────────────────────

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (columns.length === 0) {
    return <p className="text-[var(--color-muted)] text-xs px-6 py-4">No rows returned.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-max">
        <thead>
          <tr className="text-left border-b-2 border-black" style={{ background: "var(--color-background)" }}>
            {columns.map((c) => (
              <th key={c} className="px-4 py-3 font-bold uppercase tracking-wider whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-[var(--color-muted-bg)]">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 font-mono text-xs text-black max-w-xs truncate whitespace-nowrap">
                  {cellValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    email: "",
    username: "",
    password: "",
    is_superadmin: false,
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Folders
  const [folders, setFolders] = useState<FolderRecord[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);

  // Embeddings
  const [embeddingCalls, setEmbeddingCalls] = useState<TableData | null>(null);
  const [embeddingCoverage, setEmbeddingCoverage] = useState<TableData | null>(null);
  const [embeddingsError, setEmbeddingsError] = useState<string | null>(null);

  // Table browser
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);

  // SQL console
  const [sql, setSql] = useState("SELECT * FROM users LIMIT 20");
  const [queryResult, setQueryResult] = useState<QueryData | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  async function fetchStats() {
    const r = await fetch(`${API_URL}/admin/stats`, { credentials: "include" });
    if (r.status === 401) { setStatsError("Not authenticated."); return; }
    if (r.status === 403) { setStatsError("Access denied — admin only."); return; }
    if (!r.ok) { setStatsError("Failed to load stats."); return; }
    setStats(await r.json());
  }

  async function fetchUsers() {
    const r = await fetch(`${API_URL}/admin/users`, { credentials: "include" });
    if (r.status === 401) { setUsersError("Not authenticated."); return; }
    if (r.status === 403) { setUsersError("Superadmin access required."); return; }
    if (!r.ok) { setUsersError("Failed to load users."); return; }
    const data: UserRecord[] = await r.json();
    setUsers(data);
    const me = data.find((u) => u.is_superadmin);
    if (me) setCurrentUserId(me.id);
  }

  async function fetchFolders() {
    setFoldersError(null);
    const r = await fetch("/api/folders", { credentials: "include" });
    if (!r.ok) { setFoldersError("Failed to load folders."); return; }
    setFolders(await r.json());
  }

  async function moveFolderToRoot(id: string) {
    const r = await fetch(`/api/folders/${id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: null }),
    });
    if (r.ok) fetchFolders();
  }

  async function deleteFolderAdmin(id: string) {
    const r = await fetch(`/api/folders/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok || r.status === 204) setFolders((prev) => prev?.filter((f) => f.id !== id) ?? null);
  }

  async function fetchTables() {
    const r = await fetch(`${API_URL}/admin/tables`, { credentials: "include" });
    if (!r.ok) return;
    const data = await r.json();
    const list: string[] = data.tables ?? [];
    setTables(list);
    if (list.length > 0 && !activeTable) {
      setActiveTable(list[0]);
    }
  }

  async function fetchEmbeddings() {
    setEmbeddingsError(null);
    const [callsRes, coverageRes] = await Promise.all([
      fetch(`${API_URL}/admin/embeddings?page=1&page_size=50`, { credentials: "include" }),
      fetch(`${API_URL}/admin/embedding-coverage?page=1&page_size=50`, { credentials: "include" }),
    ]);

    if (!callsRes.ok || !coverageRes.ok) {
      setEmbeddingsError("Failed to load embedding tables.");
      return;
    }

    const [callsData, coverageData] = await Promise.all([callsRes.json(), coverageRes.json()]);
    setEmbeddingCalls(callsData);
    setEmbeddingCoverage(coverageData);
  }

  async function fetchTablePage(name: string, page = 1) {
    setTableLoading(true);
    setTableError(null);
    const r = await fetch(`${API_URL}/admin/table/${name}?page=${page}&page_size=50`, {
      credentials: "include",
    });
    setTableLoading(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setTableError((body as { error?: string }).error ?? "Failed to load table.");
      return;
    }
    setTableData(await r.json());
  }

  async function resetCircuitBreaker() {
    setResetting(true);
    const r = await fetch(`${API_URL}/admin/circuit-breaker/reset`, { method: "POST", credentials: "include" });
    setResetting(false);
    if (r.ok) fetchStats();
  }

  async function deleteUser(id: string) {
    const r = await fetch(`${API_URL}/admin/users/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) {
      setUsers((prev) => prev?.filter((u) => u.id !== id) ?? null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    const r = await fetch(`${API_URL}/admin/users`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: createForm.email,
        username: createForm.username || null,
        password: createForm.password,
        is_superadmin: createForm.is_superadmin,
      }),
    });
    setCreating(false);
    if (r.status === 409) {
      const body = await r.json();
      setCreateError(body.error === "email_already_exists" ? "Email already exists." : "Username taken.");
      return;
    }
    if (!r.ok) { setCreateError("Failed to create user."); return; }
    setCreateForm({ email: "", username: "", password: "", is_superadmin: false });
    fetchUsers();
  }

  async function runQuery() {
    setQueryRunning(true);
    setQueryError(null);
    setQueryResult(null);
    const r = await fetch(`${API_URL}/admin/query`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    setQueryRunning(false);
    const body = await r.json();
    if (!r.ok) {
      setQueryError((body as { error?: string }).error ?? "Query failed.");
      return;
    }
    setQueryResult(body as QueryData);
  }

  // Load table data when active tab changes.
  useEffect(() => {
    if (!activeTable) return;
    void (async () => {
      await fetchTablePage(activeTable);
    })();
  }, [activeTable]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        fetchStats(),
        fetchUsers(),
        fetchFolders(),
        fetchEmbeddings(),
        fetchTables(),
      ]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen p-8 font-mono" style={{ background: "var(--color-background)" }}>
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-black uppercase tracking-tight">Admin Dashboard</h1>
          <Link
            href="/admin/oauth-clients"
            className="text-xs font-bold uppercase tracking-wider underline"
          >
            OAuth clients →
          </Link>
        </div>

        {/* ── Stats ── */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">Founder Stats</h2>

          {statsError ? (
            <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">{statsError}</p>
          ) : !stats ? (
            <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
          ) : (
            <>
              {stats.circuit_breaker_active && (
                <div
                  className="border-2 border-[var(--color-danger)] bg-[#FFD6CC] p-4 flex items-center justify-between"
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "4px 4px 0px var(--color-danger)" }}
                >
                  <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">
                    CIRCUIT BREAKER OPEN — new agent invocations are blocked.
                  </p>
                  <button
                    onClick={resetCircuitBreaker}
                    disabled={resetting}
                    className="ml-4 text-xs border-2 border-[var(--color-danger)] bg-[var(--color-danger)] text-white px-3 py-1.5 font-bold uppercase tracking-wider disabled:opacity-50"
                    style={{ borderRadius: "var(--border-radius)" }}
                  >
                    {resetting ? "Resetting…" : "Reset"}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Kpi label="Daily spend" value={fmt(stats.aggregate_daily_spend_usd)} />
                <Kpi label="Monthly spend" value={fmt(stats.aggregate_monthly_spend_usd)} />
                <Kpi label="Total users" value={String(stats.total_users)} />
                <Kpi label="Active subs" value={String(stats.active_subscriptions)} />
              </div>

              <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
                <div className="px-6 py-4 border-b-2 border-black" style={{ background: "var(--color-muted-bg)" }}>
                  <h3 className="font-bold text-xs uppercase tracking-wider">Top users by monthly spend</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b-2 border-black" style={{ background: "var(--color-background)" }}>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 text-right font-bold uppercase tracking-wider">Spend (MTD)</th>
                      <th className="px-6 py-3 text-right font-bold uppercase tracking-wider">Invocations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-black">
                    {stats.top_users.map((u) => (
                      <tr key={u.user_id}>
                        <td className="px-6 py-3 font-mono text-xs text-black">{u.email}</td>
                        <td className="px-6 py-3 text-right tabular-nums font-bold">{fmt(u.monthly_cost_usd)}</td>
                        <td className="px-6 py-3 text-right tabular-nums font-bold">{u.agent_invocations}</td>
                      </tr>
                    ))}
                    {stats.top_users.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-6 text-center text-[var(--color-muted)]">No usage this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-right">
                <button onClick={fetchStats} className="underline font-bold text-black hover:text-[var(--color-accent)]">
                  Reload stats
                </button>
              </p>
            </>
          )}
        </section>

        {/* ── User management ── */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">User Management</h2>

          {usersError ? (
            <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">{usersError}</p>
          ) : !users ? (
            <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
          ) : (
            <>
              <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
                <div className="px-6 py-4 border-b-2 border-black" style={{ background: "var(--color-muted-bg)" }}>
                  <h3 className="font-bold text-xs uppercase tracking-wider">All users ({users.length})</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b-2 border-black" style={{ background: "var(--color-background)" }}>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider">Username</th>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider">Role</th>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider">Created</th>
                      <th className="px-6 py-3 font-bold uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-black">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-6 py-3 font-mono text-xs text-black">{u.email}</td>
                        <td className="px-6 py-3 text-[var(--color-muted)]">{u.username ?? "—"}</td>
                        <td className="px-6 py-3">
                          {u.is_superadmin ? (
                            <span className="bg-black text-white text-xs px-2 py-0.5 font-bold uppercase tracking-wider" style={{ borderRadius: "var(--border-radius)" }}>
                              Superadmin
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted)]">User</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-[var(--color-muted)]">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3">
                          <button
                            disabled={u.id === currentUserId || u.is_superadmin}
                            onClick={() => deleteUser(u.id)}
                            className="text-xs border-2 border-[var(--color-danger)] text-[var(--color-danger)] px-2 py-1 font-bold uppercase tracking-wider hover:bg-[var(--color-danger)] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ borderRadius: "var(--border-radius)" }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-6 text-center text-[var(--color-muted)]">No users yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className={`${cardClass} p-6 space-y-4`} style={cardStyle}>
                <h3 className="font-bold text-xs uppercase tracking-wider">Create user</h3>
                <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Email" type="email" value={createForm.email} required onChange={(v) => setCreateForm((f) => ({ ...f, email: v }))} />
                  <Field label="Username (optional)" type="text" value={createForm.username} onChange={(v) => setCreateForm((f) => ({ ...f, username: v }))} />
                  <Field label="Password" type="password" value={createForm.password} required onChange={(v) => setCreateForm((f) => ({ ...f, password: v }))} />
                  <div className="flex items-center gap-3 pt-5">
                    <input
                      id="is_superadmin"
                      type="checkbox"
                      checked={createForm.is_superadmin}
                      onChange={(e) => setCreateForm((f) => ({ ...f, is_superadmin: e.target.checked }))}
                      className="w-4 h-4 border-2 border-black"
                    />
                    <label htmlFor="is_superadmin" className="text-xs font-bold uppercase tracking-wider">Superadmin</label>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <button
                      type="submit"
                      disabled={creating}
                      className="text-xs border-2 border-black bg-black text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:opacity-50"
                      style={{ borderRadius: "var(--border-radius)" }}
                    >
                      {creating ? "Creating…" : "Create user"}
                    </button>
                    {createError && <p className="text-[var(--color-danger)] text-xs font-bold">{createError}</p>}
                  </div>
                </form>
              </div>
            </>
          )}
        </section>

        {/* ── Folders ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">Folders</h2>
            <button onClick={fetchFolders} className="text-xs underline font-bold text-black hover:text-[var(--color-accent)]">
              Reload
            </button>
          </div>

          {foldersError ? (
            <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">{foldersError}</p>
          ) : !folders ? (
            <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
          ) : (
            <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
              <div className="px-6 py-4 border-b-2 border-black" style={{ background: "var(--color-muted-bg)" }}>
                <h3 className="font-bold text-xs uppercase tracking-wider">All folders ({folders.length})</h3>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b-2 border-black" style={{ background: "var(--color-background)" }}>
                    <th className="px-6 py-3 font-bold uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 font-bold uppercase tracking-wider">Parent</th>
                    <th className="px-6 py-3 font-bold uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 font-bold uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 font-bold uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black">
                  {folders.map((f) => {
                    const parent = folders.find((p) => p.id === f.parentId);
                    return (
                      <tr key={f.id}>
                        <td className="px-6 py-3 font-bold text-black">{f.name}</td>
                        <td className="px-6 py-3 text-[var(--color-muted)]">
                          {parent ? (
                            <span className="font-mono">{parent.name}</span>
                          ) : f.parentId ? (
                            <span className="text-[var(--color-danger)] font-bold">MISSING ({f.parentId.slice(0, 8)}…)</span>
                          ) : (
                            <span className="text-[var(--color-muted)]">Root</span>
                          )}
                        </td>
                        <td className="px-6 py-3 font-mono text-[var(--color-muted)]">{f.id.slice(0, 8)}…</td>
                        <td className="px-6 py-3 text-[var(--color-muted)]">
                          {new Date(f.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-3 flex items-center gap-2">
                          {f.parentId !== null && (
                            <button
                              onClick={() => moveFolderToRoot(f.id)}
                              className="text-xs border-2 border-black px-2 py-1 font-bold uppercase tracking-wider hover:bg-black hover:text-white"
                              style={{ borderRadius: "var(--border-radius)" }}
                            >
                              Move to root
                            </button>
                          )}
                          <button
                            onClick={() => deleteFolderAdmin(f.id)}
                            className="text-xs border-2 border-[var(--color-danger)] text-[var(--color-danger)] px-2 py-1 font-bold uppercase tracking-wider hover:bg-[var(--color-danger)] hover:text-white"
                            style={{ borderRadius: "var(--border-radius)" }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {folders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-6 text-center text-[var(--color-muted)]">No folders yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Embeddings ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">Embeddings</h2>
            <button onClick={fetchEmbeddings} className="text-xs underline font-bold text-black hover:text-[var(--color-accent)]">
              Reload
            </button>
          </div>

          {embeddingsError ? (
            <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">{embeddingsError}</p>
          ) : !embeddingCalls || !embeddingCoverage ? (
            <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
                <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between" style={{ background: "var(--color-muted-bg)" }}>
                  <h3 className="font-bold text-xs uppercase tracking-wider">Recent embedding API calls</h3>
                  <span className="text-xs text-[var(--color-muted)]">{embeddingCalls.total} total</span>
                </div>
                <ResultTable columns={embeddingCalls.columns} rows={embeddingCalls.rows} />
              </div>

              <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
                <div className="px-6 py-4 border-b-2 border-black flex items-center justify-between" style={{ background: "var(--color-muted-bg)" }}>
                  <h3 className="font-bold text-xs uppercase tracking-wider">Document embedding coverage</h3>
                  <span className="text-xs text-[var(--color-muted)]">{embeddingCoverage.total} documents tracked</span>
                </div>
                <ResultTable columns={embeddingCoverage.columns} rows={embeddingCoverage.rows} />
              </div>
            </div>
          )}
        </section>

        {/* ── Table browser ── */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">Table Browser</h2>

          {tables.length === 0 ? (
            <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
          ) : (
            <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
              {/* Tab bar */}
              <div className="flex overflow-x-auto border-b-2 border-black" style={{ background: "var(--color-muted-bg)" }}>
                {tables.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setActiveTable(t);
                      setTableData(null);
                    }}
                    className={[
                      "px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap border-r-2 border-black",
                      activeTable === t
                        ? "bg-black text-white"
                        : "hover:bg-black/5",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Table content */}
              <div className="min-h-[120px]">
                {tableLoading ? (
                  <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse px-6 py-4">Loading…</p>
                ) : tableError ? (
                  <p className="text-[var(--color-danger)] text-xs font-bold px-6 py-4">{tableError}</p>
                ) : tableData ? (
                  <>
                    <ResultTable columns={tableData.columns} rows={tableData.rows} />
                    {/* Pagination */}
                    <div className="px-6 py-3 border-t-2 border-black flex items-center justify-between" style={{ background: "var(--color-muted-bg)" }}>
                      <span className="text-xs text-[var(--color-muted)]">
                        {tableData.total} rows · page {tableData.page} of {Math.max(1, Math.ceil(tableData.total / tableData.page_size))}
                      </span>
                      <div className="flex gap-2">
                        <button
                          disabled={tableData.page <= 1}
                          onClick={() => activeTable && fetchTablePage(activeTable, tableData.page - 1)}
                          className="text-xs border-2 border-black px-3 py-1 font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white"
                          style={{ borderRadius: "var(--border-radius)" }}
                        >
                          Prev
                        </button>
                        <button
                          disabled={tableData.page >= Math.ceil(tableData.total / tableData.page_size)}
                          onClick={() => activeTable && fetchTablePage(activeTable, tableData.page + 1)}
                          className="text-xs border-2 border-black px-3 py-1 font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white"
                          style={{ borderRadius: "var(--border-radius)" }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </section>

        {/* ── SQL console ── */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">SQL Console</h2>
          <div className={`${cardClass} overflow-hidden`} style={cardStyle}>
            <div className="px-6 py-4 border-b-2 border-black space-y-3" style={{ background: "var(--color-muted-bg)" }}>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full bg-[var(--color-background)] border-2 border-black px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--color-accent)] resize-y"
                style={{ borderRadius: "var(--border-radius)" }}
                placeholder="SELECT * FROM users LIMIT 20"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    runQuery();
                  }
                }}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={runQuery}
                  disabled={queryRunning || !sql.trim()}
                  className="text-xs border-2 border-black bg-black text-white px-4 py-2 font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:opacity-50"
                  style={{ borderRadius: "var(--border-radius)" }}
                >
                  {queryRunning ? "Running…" : "Run Query"}
                </button>
                <span className="text-xs text-[var(--color-muted)]">or ⌘↵ / Ctrl↵</span>
                <span className="ml-auto text-xs text-[var(--color-muted)]">Read-only · SELECT only</span>
              </div>
            </div>

            <div className="min-h-[80px]">
              {queryError ? (
                <p className="text-[var(--color-danger)] text-xs font-bold font-mono px-6 py-4">{queryError}</p>
              ) : queryResult ? (
                <>
                  <ResultTable columns={queryResult.columns} rows={queryResult.rows} />
                  <div className="px-6 py-2 border-t-2 border-black" style={{ background: "var(--color-muted-bg)" }}>
                    <span className="text-xs text-[var(--color-muted)]">{queryResult.rows.length} row{queryResult.rows.length !== 1 ? "s" : ""} returned</span>
                  </div>
                </>
              ) : (
                <p className="text-[var(--color-muted)] text-xs px-6 py-4">Run a query to see results.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="bg-[var(--color-surface)] border-2 border-black p-5 font-mono"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
    >
      <p className="text-xs text-[var(--color-muted)] mb-1 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  required,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  required?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="border-2 border-black bg-[var(--color-background)] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]"
        style={{ borderRadius: "var(--border-radius)" }}
      />
    </div>
  );
}
