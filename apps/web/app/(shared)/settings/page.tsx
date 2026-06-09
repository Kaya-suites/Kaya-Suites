"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface EmbeddingModelUsage {
  model: string;
  tokens: number;
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
  totalEmbeddingTokens: number;
  byEmbeddingModel: EmbeddingModelUsage[];
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

const cardClass = "bg-[var(--color-surface)] border border-[var(--color-border)] p-6 space-y-4";
const cardStyle = { borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" };
const sectionHeading = "font-semibold text-xs  text-[var(--color-text)]";
const btnSecondary = "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-subtle)] transition-all";

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
      fetch(`${API_URL}/sessions/usage`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setTokenUsage({
            ...data,
            totalEmbeddingTokens: data.totalEmbeddingTokens ?? 0,
            byEmbeddingModel: data.byEmbeddingModel ?? [],
          });
        })
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
      <main className="h-full flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="text-center space-y-3">
          <p className="text-[var(--color-danger)] font-semibold text-xs">{error}</p>
          <Link href="/auth/signin" className="text-xs underline text-[var(--color-text)] font-semibold">Sign in →</Link>
        </div>
      </main>
    );
  }

  if (!metering) {
    return (
      <main className="h-full flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="w-full max-w-sm space-y-3 px-6">
          <div className="h-4 w-32 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
          <div className="h-3 w-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
          <div className="h-3 w-4/5 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
        </div>
      </main>
    );
  }

  const invocationPct = Math.min((metering.agent_invocations_used / metering.agent_invocations_limit) * 100, 100);
  const spendPct = Math.min((metering.spend_usd / metering.spend_cap_usd) * 100, 100);

  return (
    <main className="h-full overflow-y-auto py-12" style={{ background: "var(--color-bg)" }}>
      <div className="max-w-2xl mx-auto px-6 space-y-6">
        <h1 className="font-[var(--font-serif)] text-3xl font-semibold tracking-tight">Settings</h1>

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

          <p className="text-xs text-[var(--color-text-muted)]">
            Invocations reset on the 1st of each month.
          </p>
        </div>

        <TokenUsageCard summary={tokenUsage} />

        <ClaudeIntegrationCard />

        <ConnectedAppsCard />

        {/* Data */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Your data</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Export all your documents and chat history as a ZIP archive.</p>
          <a
            href={`${API_URL}/account/export`}
            className={btnSecondary}
            style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", display: "inline-block" }}
          >
            Download export
          </a>
        </div>

        {/* Onboarding */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Onboarding</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Show the getting-started checklist again from the beginning.</p>
          <button
            onClick={() => { localStorage.removeItem("kaya_onboarding_v1"); window.location.reload(); }}
            className={btnSecondary}
            style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" }}
          >
            Reset onboarding
          </button>
        </div>

        {/* Danger zone */}
        <div
          className="bg-[var(--color-surface)] border border-[var(--color-danger)] p-6 space-y-4"
          style={{ borderRadius: "var(--radius-md)", boxShadow: "4px 4px 0px var(--color-danger)" }}
        >
          <h2 className="font-semibold text-xs  text-[var(--color-danger)]">Delete account</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Permanently deletes your account and all data. This cannot be undone.</p>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--color-text)]">
              Type <span className="bg-[var(--color-bg-subtle)] px-1 border border-black">DELETE MY ACCOUNT</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="border border-[var(--color-border)] px-3 py-2 text-xs w-full focus:outline-none focus:border-[var(--color-danger)] bg-[var(--color-surface)] text-[var(--color-text)]"
              style={{ borderRadius: "var(--radius-md)", boxShadow: "none" }}
              placeholder="DELETE MY ACCOUNT"
            />
            <button
              onClick={handleDelete}
              disabled={deleteConfirm !== "DELETE MY ACCOUNT" || deleting}
              className="border border-[var(--color-border)] bg-[var(--color-danger)] text-[var(--color-accent-fg)] px-4 py-2 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" }}
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
  const [activeTab, setActiveTab] = useState<"chat" | "embedding">("chat");

  if (!summary) return null;
  const chatTotal = summary.totalInputTokens + summary.totalOutputTokens;
  const hasChat = chatTotal > 0 || summary.byModel.length > 0;
  const hasEmbeddings = summary.totalEmbeddingTokens > 0 || summary.byEmbeddingModel.length > 0;

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-xs font-medium border border-[var(--color-border)] transition-all ${
      active
        ? "bg-black text-[var(--color-accent-fg)]"
        : "bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]"
    }`;

  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)]"
      style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" }}
    >
      {/* Header + tabs */}
      <div className="px-6 pt-6 pb-0 space-y-4">
        <h2 className="font-semibold text-xs  text-[var(--color-text)]">Token usage</h2>
        <div className="flex gap-0 border-b border-[var(--color-border)] -mx-6 px-6">
          <button
            onClick={() => setActiveTab("chat")}
            className={tabClass(activeTab === "chat")}
            style={{ borderBottomColor: activeTab === "chat" ? "black" : "transparent", borderRadius: 0 }}
          >
            Chat models
          </button>
          <button
            onClick={() => setActiveTab("embedding")}
            className={tabClass(activeTab === "embedding")}
            style={{ borderBottomColor: activeTab === "embedding" ? "black" : "transparent", borderRadius: 0 }}
          >
            Embedding models
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {activeTab === "chat" && (
          <>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Total", value: fmtTokens(chatTotal) },
                { label: "Input", value: fmtTokens(summary.totalInputTokens) },
                { label: "Output", value: fmtTokens(summary.totalOutputTokens) },
              ].map(({ label, value }) => (
                <div key={label} className="border border-[var(--color-border)] p-3" style={{ borderRadius: "var(--radius-md)", background: "var(--color-bg-subtle)" }}>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            {summary.byModel.length > 0 && (
              <table className="w-full text-xs border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }}>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left" style={{ background: "var(--color-bg-subtle)" }}>
                    <th className="font-semibold px-3 py-2">Model</th>
                    <th className="font-semibold text-right px-3 py-2">Input</th>
                    <th className="font-semibold text-right px-3 py-2">Output</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black">
                  {summary.byModel.map((m) => (
                    <tr key={m.model}>
                      <td className="py-2 px-3 text-xs">{m.model}</td>
                      <td className="py-2 px-3 tabular-nums text-right font-semibold">{fmtTokens(m.inputTokens)}</td>
                      <td className="py-2 px-3 tabular-nums text-right font-semibold">{fmtTokens(m.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!hasChat && (
              <p className="text-xs text-[var(--color-text-muted)]">No conversations yet. Start chatting to see token usage.</p>
            )}
          </>
        )}

        {activeTab === "embedding" && (
          <>
            <div className="grid grid-cols-2 gap-4 text-center">
              {[
                { label: "Total tokens", value: fmtTokens(summary.totalEmbeddingTokens) },
                { label: "Models used", value: String(summary.byEmbeddingModel.length) },
              ].map(({ label, value }) => (
                <div key={label} className="border border-[var(--color-border)] p-3" style={{ borderRadius: "var(--radius-md)", background: "var(--color-bg-subtle)" }}>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            {summary.byEmbeddingModel.length > 0 && (
              <table className="w-full text-xs border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }}>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left" style={{ background: "var(--color-bg-subtle)" }}>
                    <th className="font-semibold px-3 py-2">Model</th>
                    <th className="font-semibold text-right px-3 py-2">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-black">
                  {summary.byEmbeddingModel.map((m) => (
                    <tr key={m.model}>
                      <td className="py-2 px-3 text-xs">{m.model}</td>
                      <td className="py-2 px-3 tabular-nums text-right font-semibold">{fmtTokens(m.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!hasEmbeddings && (
              <p className="text-xs text-[var(--color-text-muted)]">No embedding calls recorded yet. Upload or search documents to see usage.</p>
            )}
          </>
        )}

        <p className="text-xs text-[var(--color-text-muted)]">
          Chat token counts are estimates using BPE tokenization. Embedding tokens are reported by the provider API.
        </p>
      </div>
    </div>
  );
}

interface McpToken {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

interface MintedToken {
  id: string;
  name: string;
  token: string;
}

function ClaudeIntegrationCard() {
  const [tokens, setTokens] = useState<McpToken[] | null>(null);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await fetch(`${API_URL}/oauth/personal-tokens`, { credentials: "include" });
    if (r.ok) setTokens(await r.json());
  }
  useEffect(() => { refresh(); }, []);

  async function mint() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_URL}/oauth/personal-tokens`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) {
        setErr(`Mint failed (${r.status})`);
      } else {
        setMinted(await r.json());
        setName("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Clients using it will lose access.")) return;
    const r = await fetch(`${API_URL}/oauth/personal-tokens/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) await refresh();
  }

  return (
    <div className={cardClass} style={cardStyle}>
      <h2 className={sectionHeading}>Personal access tokens (MCP)</h2>
      <p className="text-xs text-[var(--color-text-muted)]">
        Mint a long-lived OAuth token to connect Kaya as an MCP server in Claude Desktop or
        Claude Code. Tokens are scoped to your user; the raw value is shown once. To revoke
        a connection that did the browser-based OAuth handshake instead, use{" "}
        <span className="font-semibold">Connected apps</span> below.
      </p>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[var(--color-text)]">
          New token name
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="e.g. laptop-claude-desktop"
            className="border border-[var(--color-border)] px-3 py-2 text-xs flex-1 focus:outline-none bg-[var(--color-surface)] text-[var(--color-text)]"
            style={{ borderRadius: "var(--radius-md)", boxShadow: "none" }}
          />
          <button
            onClick={mint}
            disabled={busy || !name.trim()}
            className={btnSecondary}
            style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" }}
          >
            {busy ? "Minting…" : "Mint token"}
          </button>
        </div>
        {err && <p className="text-xs text-[var(--color-danger)] font-semibold">{err}</p>}
      </div>

      {minted && <MintedTokenView minted={minted} onDismiss={() => setMinted(null)} />}

      {tokens && tokens.length > 0 && (
        <table className="w-full text-xs border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }}>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left" style={{ background: "var(--color-bg-subtle)" }}>
              <th className="font-semibold px-3 py-2">Name</th>
              <th className="font-semibold px-3 py-2">Created</th>
              <th className="font-semibold px-3 py-2">Last used</th>
              <th className="font-semibold px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-black">
            {tokens.map((t) => (
              <tr key={t.id}>
                <td className="py-2 px-3">{t.name}</td>
                <td className="py-2 px-3 text-[var(--color-text-muted)]">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
                <td className="py-2 px-3 text-[var(--color-text-muted)]">
                  {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "never"}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => revoke(t.id)}
                    className="text-xs font-medium text-[var(--color-danger)] hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tokens && tokens.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">No tokens yet.</p>
      )}
    </div>
  );
}

type Platform = "macos" | "windows" | "linux";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

const DESKTOP_CONFIG_PATH: Record<Platform, string> = {
  macos: "~/Library/Application Support/Claude/claude_desktop_config.json",
  windows: "%APPDATA%\\Claude\\claude_desktop_config.json",
  linux: "~/.config/Claude/claude_desktop_config.json",
};

interface ConnectedApp {
  client_id: string;
  client_name: string;
  token_count: number;
  last_used_at: number | null;
  first_authorized_at: number;
}

function ConnectedAppsCard() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);

  async function refresh() {
    const r = await fetch(`${API_URL}/oauth/connected-apps`, { credentials: "include" });
    if (r.ok) setApps(await r.json());
  }
  useEffect(() => { refresh(); }, []);

  async function revoke(client_id: string, name: string) {
    if (!confirm(`Revoke all access for "${name}"? It will need to reconnect.`)) return;
    const r = await fetch(`${API_URL}/oauth/connected-apps/${client_id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) await refresh();
  }

  if (!apps) return null;

  return (
    <div className={cardClass} style={cardStyle}>
      <h2 className={sectionHeading}>Connected apps</h2>
      <p className="text-xs text-[var(--color-text-muted)]">
        OAuth clients you have granted access to via the browser consent screen
        (e.g. Claude Desktop's remote MCP flow). Revoke at any time.
      </p>

      {apps.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No connected apps yet.</p>
      ) : (
        <table className="w-full text-xs border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }}>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left" style={{ background: "var(--color-bg-subtle)" }}>
              <th className="font-semibold px-3 py-2">App</th>
              <th className="font-semibold px-3 py-2">Tokens</th>
              <th className="font-semibold px-3 py-2">First authorized</th>
              <th className="font-semibold px-3 py-2">Last used</th>
              <th className="font-semibold px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-black">
            {apps.map((a) => (
              <tr key={a.client_id}>
                <td className="py-2 px-3 font-semibold">{a.client_name}</td>
                <td className="py-2 px-3 tabular-nums">{a.token_count}</td>
                <td className="py-2 px-3 text-[var(--color-text-muted)]">
                  {new Date(a.first_authorized_at).toLocaleDateString()}
                </td>
                <td className="py-2 px-3 text-[var(--color-text-muted)]">
                  {a.last_used_at ? new Date(a.last_used_at).toLocaleString() : "never"}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => revoke(a.client_id, a.client_name)}
                    className="text-xs font-medium text-[var(--color-danger)] hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MintedTokenView({ minted, onDismiss }: { minted: MintedToken; onDismiss: () => void }) {
  const [platform, setPlatform] = useState<Platform>("macos");
  useEffect(() => { setPlatform(detectPlatform()); }, []);

  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        kaya: {
          command: "/absolute/path/to/kaya-mcp",
          env: {
            KAYA_API_TOKEN: minted.token,
            DATABASE_URL: "sqlite:///absolute/path/to/kaya.db",
          },
        },
      },
    },
    null,
    2,
  );
  const codeCommand =
    `claude mcp add kaya /absolute/path/to/kaya-mcp ` +
    `-e KAYA_API_TOKEN=${minted.token} ` +
    `-e DATABASE_URL=sqlite:///absolute/path/to/kaya.db`;

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  const snippet =
    "border border-[var(--color-border)] p-3 text-xs whitespace-pre-wrap break-all bg-[var(--color-bg-subtle)]";

  return (
    <div
      className="border border-[var(--color-accent)] p-4 space-y-3"
      style={{ borderRadius: "var(--radius-md)", boxShadow: "4px 4px 0px var(--color-accent)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-xs  text-[var(--color-text)]">
            Token created — copy it now
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            You will not see this value again. Replace the placeholder paths with your local kaya-mcp binary and database file.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-xs font-medium underline"
        >
          Dismiss
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Token</span>
          <button onClick={() => copy(minted.token)} className="text-xs font-semibold underline">Copy</button>
        </div>
        <div className={snippet} style={{ borderRadius: "var(--radius-md)" }}>{minted.token}</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            Claude Desktop · paste into config
          </span>
          <div className="flex gap-2 items-center">
            <PlatformPicker value={platform} onChange={setPlatform} />
            <button onClick={() => copy(desktopJson)} className="text-xs font-semibold underline">Copy</button>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Edit <code className="bg-[var(--color-bg-subtle)] px-1 border border-black">{DESKTOP_CONFIG_PATH[platform]}</code>, then restart Claude Desktop.
        </p>
        <div className={snippet} style={{ borderRadius: "var(--radius-md)" }}>{desktopJson}</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Claude Code · CLI</span>
          <button onClick={() => copy(codeCommand)} className="text-xs font-semibold underline">Copy</button>
        </div>
        <div className={snippet} style={{ borderRadius: "var(--radius-md)" }}>{codeCommand}</div>
      </div>
    </div>
  );
}

function PlatformPicker({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  const opt = (p: Platform, label: string) => (
    <button
      key={p}
      onClick={() => onChange(p)}
      className={`px-2 py-1 text-xs font-medium border border-[var(--color-border)] ${
        value === p ? "bg-black text-[var(--color-accent-fg)]" : "bg-[var(--color-surface)] text-[var(--color-text)]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex">
      {opt("macos", "macOS")}
      {opt("windows", "Win")}
      {opt("linux", "Linux")}
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
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="font-medium text-[var(--color-text)]">{label}</span>
        <span className="tabular-nums text-[var(--color-text)] font-semibold">
          {formatUsed(used)} / {formatLimit(limit)}
        </span>
      </div>
      <div className="h-2 border border-[var(--color-border)] overflow-hidden" style={{ borderRadius: "var(--radius-md)", background: "var(--color-bg-subtle)" }}>
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
