"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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

function fmt(usd: number) {
  return `$${usd.toFixed(4)}`;
}

const cardClass = "bg-[var(--color-surface)] border-2 border-black";
const cardStyle = { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" };

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function fetchStats() {
    const r = await fetch(`${API_URL}/admin/stats`, { credentials: "include" });
    if (r.status === 401) { setError("Not authenticated."); return; }
    if (r.status === 403) { setError("Access denied — admin only."); return; }
    if (!r.ok) { setError("Failed to load stats."); return; }
    setStats(await r.json());
  }

  async function resetCircuitBreaker() {
    setResetting(true);
    const r = await fetch(`${API_URL}/admin/circuit-breaker/reset`, { method: "POST", credentials: "include" });
    setResetting(false);
    if (r.ok) fetchStats();
  }

  useEffect(() => { fetchStats(); }, []);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center font-mono" style={{ background: "var(--color-background)" }}>
        <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">{error}</p>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="min-h-screen flex items-center justify-center font-mono" style={{ background: "var(--color-background)" }}>
        <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 font-mono" style={{ background: "var(--color-background)" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-black uppercase tracking-tight">Founder Dashboard</h1>

        {stats.circuit_breaker_active && (
          <div
            className="border-2 border-[var(--color-danger)] bg-[#FFD6CC] p-4 flex items-center justify-between"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "4px 4px 0px var(--color-danger)" }}
          >
            <p className="text-[var(--color-danger)] font-bold text-xs uppercase tracking-wider">
              ⚠ CIRCUIT BREAKER OPEN — new agent invocations are blocked.
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
            <h2 className="font-bold text-xs uppercase tracking-wider">Top users by monthly spend</h2>
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
                  <td colSpan={3} className="px-6 py-6 text-center text-[var(--color-muted)]">
                    No usage this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[var(--color-muted)] text-right">
          <button onClick={fetchStats} className="underline font-bold text-black hover:text-[var(--color-accent)]">
            Reload stats
          </button>
        </p>
      </div>
    </main>
  );
}

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
