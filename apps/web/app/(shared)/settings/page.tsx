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

interface BillingStatus {
  status: "active" | "grace_period" | "cancelled" | "refunded" | "none";
  current_period_end: string | null;
  refund_days_remaining: number | null;
  paddle_customer_id: string | null;
}

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

function statusLabel(s: BillingStatus["status"]) {
  switch (s) {
    case "active": return { text: "Active", color: "text-green-700 bg-green-50 border-green-200" };
    case "grace_period": return { text: "Past due", color: "text-yellow-700 bg-yellow-50 border-yellow-200" };
    case "cancelled": return { text: "Cancelled", color: "text-gray-600 bg-gray-50 border-gray-200" };
    case "refunded": return { text: "Refunded", color: "text-gray-600 bg-gray-50 border-gray-200" };
    default: return { text: "No plan", color: "text-gray-500 bg-gray-50 border-gray-200" };
  }
}

export default function SettingsPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [metering, setMetering] = useState<MeteringSummary | null>(null);
  const [tokenUsage, setTokenUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundDone, setRefundDone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const [bRes, mRes] = await Promise.all([
        fetch(`${API_URL}/billing/status`, { credentials: "include" }),
        fetch(`${API_URL}/metering/summary`, { credentials: "include" }),
      ]);
      if (bRes.status === 401 || mRes.status === 401) {
        setError("Not signed in.");
        return;
      }
      if (!bRes.ok || !mRes.ok) {
        setError("Failed to load settings.");
        return;
      }
      const [b, m] = await Promise.all([bRes.json(), mRes.json()]);
      setBilling(b);
      setMetering(m);

      // Token usage is best-effort — don't block the page on failure.
      fetch("/api/usage")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) setTokenUsage(data); })
        .catch(() => {});
    }
    load();
  }, []);

  async function handleRefund() {
    if (!confirm("Request a full refund? Your subscription will be cancelled immediately.")) return;
    setRefunding(true);
    const r = await fetch(`${API_URL}/billing/refund`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setRefunding(false);
    if (r.ok) {
      setRefundDone(true);
      setBilling((prev) => prev ? { ...prev, status: "refunded" } : prev);
    } else {
      const body = await r.json().catch(() => ({}));
      alert(body.error ?? "Refund failed.");
    }
  }

  async function handleDelete() {
    if (deleteConfirm !== "DELETE MY ACCOUNT") return;
    setDeleting(true);
    const r = await fetch(`${API_URL}/account/delete`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }),
    });
    setDeleting(false);
    if (r.ok) {
      window.location.href = "/";
    } else {
      alert("Deletion failed. Please try again or contact support.");
    }
  }

  if (error) {
    return (
      <main className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <p className="text-red-600">{error}</p>
          <Link href="/auth/signin" className="text-sm underline text-gray-500">Sign in →</Link>
        </div>
      </main>
    );
  }

  if (!billing || !metering) {
    return (
      <main className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading…</p>
      </main>
    );
  }

  const { text: statusText, color: statusColor } = statusLabel(billing.status);
  const invocationPct = Math.min(
    (metering.agent_invocations_used / metering.agent_invocations_limit) * 100,
    100
  );
  const spendPct = Math.min((metering.spend_usd / metering.spend_cap_usd) * 100, 100);

  return (
    <main className="h-full overflow-y-auto bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-6 space-y-8">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

        {refundDone && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
            Refund requested. You will receive a confirmation from Paddle within 5–10 business days.
          </div>
        )}

        {/* Subscription card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-900">Subscription</h2>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusColor}`}>
              {statusText}
            </span>
          </div>

          {billing.current_period_end && (
            <p className="text-sm text-gray-500">
              {billing.status === "cancelled" ? "Access until" : "Renews"}{" "}
              {new Date(billing.current_period_end).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}

          {billing.status === "none" && (
            <Link
              href="/billing/subscribe"
              className="inline-block bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-700 transition-colors"
            >
              Subscribe — $10 / month
            </Link>
          )}

          {billing.status === "active" && billing.paddle_customer_id && (
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href="https://customer.paddle.com/portal"
                target="_blank"
                rel="noreferrer"
                className="text-sm underline text-gray-500 hover:text-gray-800"
              >
                Manage billing ↗
              </a>
              {billing.refund_days_remaining && billing.refund_days_remaining > 0 && !refundDone && (
                <button
                  onClick={handleRefund}
                  disabled={refunding}
                  className="text-sm underline text-gray-400 hover:text-red-600 disabled:opacity-50"
                >
                  {refunding ? "Requesting refund…" : `Request refund (${billing.refund_days_remaining}d remaining)`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Usage card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <h2 className="font-medium text-gray-900">
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

          <p className="text-xs text-gray-400">
            Invocations reset on the 1st of each month. Spend cap is per user, per period.
          </p>
        </div>

        {/* Token usage card */}
        <TokenUsageCard summary={tokenUsage} />

        {/* Data portability */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-medium text-gray-900">Your data</h2>
          <p className="text-sm text-gray-500">
            Export all your documents and chat history as a ZIP archive.
          </p>
          <a
            href={`${API_URL}/account/export`}
            className="inline-block border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:border-gray-400 transition-colors"
          >
            Download export
          </a>
        </div>

        {/* Onboarding */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-medium text-gray-900">Onboarding</h2>
          <p className="text-sm text-gray-500">
            Show the getting-started checklist again from the beginning.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem("kaya_onboarding_v1");
              window.location.reload();
            }}
            className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:border-gray-400 transition-colors"
          >
            Reset onboarding
          </button>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-xl border border-red-100 p-6 space-y-4">
          <h2 className="font-medium text-red-700">Delete account</h2>
          <p className="text-sm text-gray-500">
            Permanently deletes your account and all data. This cannot be undone.
          </p>
          <div className="space-y-2">
            <label className="block text-xs text-gray-500">
              Type <span className="font-mono font-semibold">DELETE MY ACCOUNT</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder="DELETE MY ACCOUNT"
            />
            <button
              onClick={handleDelete}
              disabled={deleteConfirm !== "DELETE MY ACCOUNT" || deleting}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <h2 className="font-medium text-gray-900">Token usage</h2>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Total</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{fmtTokens(total)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Input</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{fmtTokens(summary.totalInputTokens)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Output</p>
          <p className="text-lg font-semibold tabular-nums text-gray-900">{fmtTokens(summary.totalOutputTokens)}</p>
        </div>
      </div>

      {/* Per-model breakdown */}
      {summary.byModel.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">By model</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="pb-1 font-normal">Model</th>
                <th className="pb-1 font-normal text-right">Input</th>
                <th className="pb-1 font-normal text-right">Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {summary.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="py-1.5 font-mono text-xs text-gray-700 pr-4">{m.model}</td>
                  <td className="py-1.5 tabular-nums text-gray-900 text-right pr-4">{fmtTokens(m.inputTokens)}</td>
                  <td className="py-1.5 tabular-nums text-gray-900 text-right">{fmtTokens(m.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-session breakdown */}
      {summary.sessions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">By conversation</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 text-left">
                <th className="pb-1 font-normal">Conversation</th>
                <th className="pb-1 font-normal text-right">Input</th>
                <th className="pb-1 font-normal text-right">Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {summary.sessions.map((s) => (
                <tr key={s.sessionId}>
                  <td className="py-1.5 text-gray-700 pr-4 truncate max-w-[200px]">{s.title}</td>
                  <td className="py-1.5 tabular-nums text-gray-900 text-right pr-4">{fmtTokens(s.inputTokens)}</td>
                  <td className="py-1.5 tabular-nums text-gray-900 text-right">{fmtTokens(s.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total === 0 && (
        <p className="text-sm text-gray-400">No conversations yet. Start chatting to see token usage.</p>
      )}

      <p className="text-xs text-gray-400">
        Counts are estimates computed locally from message text using BPE tokenization.
      </p>
    </div>
  );
}

function UsageBar<T extends number>({
  label,
  used,
  limit,
  pct,
  formatUsed,
  formatLimit,
}: {
  label: string;
  used: T;
  limit: T;
  pct: number;
  formatUsed: (n: T) => string;
  formatLimit: (n: T) => string;
}) {
  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-400" : "bg-gray-900";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="tabular-nums text-gray-900 font-medium">
          {formatUsed(used)} / {formatLimit(limit)}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
