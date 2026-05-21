"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface SessionTokenUsage {
  sessionId: string;
  title: string;
  inputTokens: number;
  outputTokens: number;
  updatedAt: number;
}

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: ModelUsage[];
  sessions: SessionTokenUsage[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface MeteringSummary {
  agent_invocations_used: number;
  agent_invocations_limit: number;
  spend_usd: number;
  spend_cap_usd: number;
  period_start: string;
}

function fmt(n: number) {
  return `$${n.toFixed(4)}`;
}

const cardClass = "bg-[var(--color-surface)] border-2 border-black p-6 space-y-4";
const cardStyle = { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" };
const sectionHeading = "font-bold text-xs uppercase tracking-wider text-black font-mono";
const btnSecondary = "border-2 border-black bg-[var(--color-surface)] text-black px-4 py-2 text-xs font-bold uppercase tracking-wider font-mono hover:bg-[var(--color-muted-bg)] transition-all";

export default function SettingsPage() {
  const [metering, setMetering] = useState<MeteringSummary | null>(null);
  const [tokenUsage, setTokenUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const mRes = await fetch(`${API_URL}/metering/summary`, { credentials: "include" });
      if (mRes.status === 401) { setError("Not signed in."); return; }
      if (!mRes.ok) { setError("Failed to load settings."); return; }
      setMetering(await mRes.json());
      fetch("/api/usage")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) setTokenUsage(data); })
        .catch(() => {});
    }
    load();
  }, []);

  async function handleDelete() {
    if (deleteConfirm !== "DELETE MY ACCOUNT") return;
    setDeleting(true);
    const r = await fetch(`${API_URL}/account/delete`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }),
    });
    setDeleting(false);
    if (r.ok) { window.location.href = "/"; }
    else { alert("Deletion failed. Please try again or contact support."); }
  }

  if (error) {
    return (
      <main className="h-full flex items-center justify-center" style={{ background: "var(--color-background)" }}>
        <div className="text-center space-y-3 font-mono">
          <p className="text-[var(--color-danger)] font-bold text-xs uppercase">{error}</p>
          <Link href="/auth/signin" className="text-xs underline text-black font-bold">Sign in →</Link>
        </div>
      </main>
    );
  }

  if (!metering) {
    return (
      <main className="h-full flex items-center justify-center" style={{ background: "var(--color-background)" }}>
        <p className="text-[var(--color-muted)] text-xs font-mono uppercase tracking-wider animate-pulse">Loading…</p>
      </main>
    );
  }

  const invocationPct = Math.min((metering.agent_invocations_used / metering.agent_invocations_limit) * 100, 100);
  const spendPct = Math.min((metering.spend_usd / metering.spend_cap_usd) * 100, 100);

  return (
    <main className="h-full overflow-y-auto py-12 font-mono" style={{ background: "var(--color-background)" }}>
      <div className="max-w-2xl mx-auto px-6 space-y-6">
        <h1 className="text-2xl font-black uppercase tracking-tight">Settings</h1>

        {/* Usage */}
        <div className={cardClass} style={{ ...cardStyle, gap: "1.5rem" }}>
          <h2 className={sectionHeading}>
            Usage · {new Date(metering.period_start + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h2>

          <UsageBar
            label="Agent invocations"
            used={metering.agent_invocations_used}
            limit={metering.agent_invocations_limit}
            pct={invocationPct}
            formatUsed={String}
            formatLimit={String}
          />

          <UsageBar
            label="AI spend"
            used={metering.spend_usd}
            limit={metering.spend_cap_usd}
            pct={spendPct}
            formatUsed={(n) => fmt(n)}
            formatLimit={(n) => fmt(n)}
          />

          <p className="text-xs text-[var(--color-muted)]">
            Invocations reset on the 1st of each month.
          </p>
        </div>

        <TokenUsageCard summary={tokenUsage} />

        {/* Data */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Your data</h2>
          <p className="text-xs text-[var(--color-muted)]">Export all your documents and chat history as a ZIP archive.</p>
          <a
            href={`${API_URL}/account/export`}
            className={btnSecondary}
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)", display: "inline-block" }}
          >
            Download export
          </a>
        </div>

        {/* Onboarding */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Onboarding</h2>
          <p className="text-xs text-[var(--color-muted)]">Show the getting-started checklist again from the beginning.</p>
          <button
            onClick={() => { localStorage.removeItem("kaya_onboarding_v1"); window.location.reload(); }}
            className={btnSecondary}
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Reset onboarding
          </button>
        </div>

        {/* Danger zone */}
        <div
          className="bg-[var(--color-surface)] border-2 border-[var(--color-danger)] p-6 space-y-4"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "4px 4px 0px var(--color-danger)" }}
        >
          <h2 className="font-bold text-xs uppercase tracking-wider text-[var(--color-danger)]">Delete account</h2>
          <p className="text-xs text-[var(--color-muted)]">Permanently deletes your account and all data. This cannot be undone.</p>
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-black">
              Type <span className="font-mono bg-[var(--color-muted-bg)] px-1 border border-black">DELETE MY ACCOUNT</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="border-2 border-black px-3 py-2 text-xs w-full focus:outline-none focus:border-[var(--color-danger)] bg-white text-black font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              placeholder="DELETE MY ACCOUNT"
            />
            <button
              onClick={handleDelete}
              disabled={deleteConfirm !== "DELETE MY ACCOUNT" || deleting}
              className="border-2 border-black bg-[var(--color-danger)] text-white px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TokenUsageCard({ summary }: { summary: UsageSummary | null }) {
  if (!summary) return null;
  const total = summary.totalInputTokens + summary.totalOutputTokens;

  return (
    <div
      className="bg-[var(--color-surface)] border-2 border-black p-6 space-y-5 font-mono"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="font-bold text-xs uppercase tracking-wider text-black">Token usage</h2>

      <div className="grid grid-cols-3 gap-4 text-center">
        {[
          { label: "Total", value: fmtTokens(total) },
          { label: "Input", value: fmtTokens(summary.totalInputTokens) },
          { label: "Output", value: fmtTokens(summary.totalOutputTokens) },
        ].map(({ label, value }) => (
          <div key={label} className="border-2 border-black p-3" style={{ borderRadius: "var(--border-radius)", background: "var(--color-muted-bg)" }}>
            <p className="text-xs text-[var(--color-muted)] mb-1 uppercase">{label}</p>
            <p className="text-lg font-black tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {summary.byModel.length > 0 && (
        <div>
          <p className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider mb-2">By model</p>
          <table className="w-full text-xs border-2 border-black" style={{ borderRadius: "var(--border-radius)" }}>
            <thead>
              <tr className="border-b-2 border-black text-left" style={{ background: "var(--color-muted-bg)" }}>
                <th className="pb-1 font-bold px-3 py-2 uppercase">Model</th>
                <th className="pb-1 font-bold text-right px-3 py-2 uppercase">Input</th>
                <th className="pb-1 font-bold text-right px-3 py-2 uppercase">Output</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black">
              {summary.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="py-2 px-3 font-mono text-xs text-black">{m.model}</td>
                  <td className="py-2 px-3 tabular-nums text-right font-bold">{fmtTokens(m.inputTokens)}</td>
                  <td className="py-2 px-3 tabular-nums text-right font-bold">{fmtTokens(m.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total === 0 && (
        <p className="text-xs text-[var(--color-muted)]">No conversations yet. Start chatting to see token usage.</p>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Counts are estimates computed locally from message text using BPE tokenization.
      </p>
    </div>
  );
}

function UsageBar<T extends number>({
  label, used, limit, pct, formatUsed, formatLimit,
}: {
  label: string; used: T; limit: T; pct: number;
  formatUsed: (n: T) => string; formatLimit: (n: T) => string;
}) {
  const barColor = pct >= 100 ? "var(--color-danger)" : pct >= 80 ? "var(--color-warning)" : "var(--color-accent)";
  return (
    <div className="space-y-1.5 font-mono">
      <div className="flex justify-between text-xs">
        <span className="font-bold uppercase tracking-wider text-black">{label}</span>
        <span className="tabular-nums text-black font-bold">
          {formatUsed(used)} / {formatLimit(limit)}
        </span>
      </div>
      <div className="h-2 border-2 border-black overflow-hidden" style={{ borderRadius: "var(--border-radius)", background: "var(--color-muted-bg)" }}>
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
