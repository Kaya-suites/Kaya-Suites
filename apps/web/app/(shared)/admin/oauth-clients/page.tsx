"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface OAuthClient {
  id: string;
  name: string;
  client_type: "public" | "confidential";
  redirect_uris: string[];
  created_at: number;
}

interface CreatedClient {
  client_id: string;
  client_secret?: string;
  name: string;
  redirect_uris: string[];
}

const cardClass = "bg-[var(--color-surface)] border border-[var(--color-border)] p-6 space-y-4";
const cardStyle = { borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-md)" };
const sectionHeading = "font-semibold text-xs  text-[var(--color-text)]";
const inputClass =
  "border border-[var(--color-border)] px-3 py-2 text-xs focus:outline-none bg-[var(--color-surface)] text-[var(--color-text)]";
const btnPrimary =
  "border border-[var(--color-border)] bg-black text-[var(--color-accent-fg)] px-4 py-2 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed";
const btnSecondary =
  "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-4 py-2 text-xs font-medium hover:bg-[var(--color-bg-subtle)]";

export default function AdminOAuthClientsPage() {
  const [clients, setClients] = useState<OAuthClient[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [redirects, setRedirects] = useState("");
  const [clientType, setClientType] = useState<"public" | "confidential">("public");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedClient | null>(null);

  async function refresh() {
    const r = await fetch(`${API_URL}/admin/oauth/clients`, { credentials: "include" });
    if (r.status === 401) { setErr("Sign in required."); return; }
    if (r.status === 403) { setErr("Superadmin only."); return; }
    if (!r.ok) { setErr(`Failed to load (HTTP ${r.status}).`); return; }
    setClients(await r.json());
  }
  useEffect(() => { refresh(); }, []);

  async function mint() {
    setBusy(true);
    setErr(null);
    const redirect_uris = redirects
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || redirect_uris.length === 0) {
      setErr("Name and at least one redirect URI required.");
      setBusy(false);
      return;
    }
    try {
      const r = await fetch(`${API_URL}/admin/oauth/clients`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), redirect_uris, client_type: clientType }),
      });
      if (!r.ok) {
        const body = await r.text();
        setErr(`Mint failed (HTTP ${r.status}): ${body}`);
      } else {
        setCreated(await r.json());
        setName("");
        setRedirects("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke OAuth client "${name}"? All issued tokens will be invalidated.`)) return;
    const r = await fetch(`${API_URL}/admin/oauth/clients/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) await refresh();
  }

  if (err && !clients) {
    return (
      <main
        className="h-full flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="text-center space-y-3">
          <p className="text-[var(--color-danger)] font-semibold text-xs">{err}</p>
          <Link href="/" className="text-xs underline font-semibold">Back to Kaya →</Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="h-full overflow-y-auto py-12"
      style={{ background: "var(--color-bg)" }}
    >
      <div className="max-w-3xl mx-auto px-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-[var(--font-serif)] text-3xl font-semibold tracking-tight">OAuth clients</h1>
          <Link href="/admin" className="text-xs font-semibold underline">
            ← Admin
          </Link>
        </div>

        {/* Mint form */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Register a new client</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Manually-registered clients are an alternative to Dynamic Client Registration —
            use this when the integrating app can&apos;t discover the OAuth flow on its own.
            For Claude Desktop, DCR via <code className="bg-[var(--color-bg-subtle)] px-1 border border-black">/.well-known/oauth-authorization-server</code> works automatically and you don&apos;t need to register here.
          </p>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="e.g. Internal automation"
                className={`${inputClass} w-full`}
                style={{ borderRadius: "var(--radius-md)", boxShadow: "none" }}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium">
                Redirect URIs (one per line)
              </label>
              <textarea
                value={redirects}
                onChange={(e) => setRedirects(e.target.value)}
                disabled={busy}
                placeholder="http://localhost:7321/cb"
                rows={3}
                className={`${inputClass} w-full`}
                style={{ borderRadius: "var(--radius-md)", boxShadow: "none" }}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium">Client type</label>
              <div className="flex gap-3 text-xs">
                {(["public", "confidential"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={clientType === t}
                      onChange={() => setClientType(t)}
                      disabled={busy}
                    />
                    <span>{t}</span>
                    <span className="text-[var(--color-text-muted)]">
                      ({t === "public" ? "PKCE-only, no secret" : "with secret"})
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={mint}
              disabled={busy}
              className={btnPrimary}
              style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)" }}
            >
              {busy ? "Minting…" : "Register client"}
            </button>
            {err && <p className="text-xs text-[var(--color-danger)] font-semibold">{err}</p>}
          </div>

          {created && <CreatedClientView created={created} onDismiss={() => setCreated(null)} />}
        </div>

        {/* List */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Registered clients</h2>
          {clients && clients.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No manually-registered clients.</p>
          )}
          {clients && clients.length > 0 && (
            <table className="w-full text-xs border border-[var(--color-border)]" style={{ borderRadius: "var(--radius-md)" }}>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left" style={{ background: "var(--color-bg-subtle)" }}>
                  <th className="font-semibold px-3 py-2">Name</th>
                  <th className="font-semibold px-3 py-2">Type</th>
                  <th className="font-semibold px-3 py-2">Redirect URIs</th>
                  <th className="font-semibold px-3 py-2">Created</th>
                  <th className="font-semibold px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black">
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 px-3 font-semibold break-all">{c.name}</td>
                    <td className="py-2 px-3">{c.client_type}</td>
                    <td className="py-2 px-3 text-[var(--color-text-muted)] break-all">
                      {c.redirect_uris.join(", ")}
                    </td>
                    <td className="py-2 px-3 text-[var(--color-text-muted)]">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => revoke(c.id, c.name)}
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
      </div>
    </main>
  );
}

function CreatedClientView({
  created,
  onDismiss,
}: {
  created: CreatedClient;
  onDismiss: () => void;
}) {
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  const snippet =
    "border border-[var(--color-border)] p-3 text-xs whitespace-pre-wrap break-all bg-[var(--color-bg-subtle)]";

  return (
    <div
      className="border border-[var(--color-accent)] p-4 space-y-3 mt-4"
      style={{ borderRadius: "var(--radius-md)", boxShadow: "4px 4px 0px var(--color-accent)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-xs  text-[var(--color-text)]">
            Client created — copy now
          </p>
          {created.client_secret ? (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              The client secret will not be shown again. Hand the ID + secret to the integrator out of band.
            </p>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Public client — no secret. The client authenticates with PKCE only.
            </p>
          )}
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
          <span className="text-xs font-medium">Client ID</span>
          <button onClick={() => copy(created.client_id)} className="text-xs font-semibold underline">Copy</button>
        </div>
        <div className={snippet} style={{ borderRadius: "var(--radius-md)" }}>{created.client_id}</div>
      </div>

      {created.client_secret && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Client secret</span>
            <button onClick={() => copy(created.client_secret!)} className="text-xs font-semibold underline">Copy</button>
          </div>
          <div className={snippet} style={{ borderRadius: "var(--radius-md)" }}>{created.client_secret}</div>
        </div>
      )}
    </div>
  );
}
