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

const cardClass = "bg-[var(--color-surface)] border-2 border-black p-6 space-y-4";
const cardStyle = { borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" };
const sectionHeading = "font-bold text-xs uppercase tracking-wider text-black font-mono";
const inputClass =
  "border-2 border-black px-3 py-2 text-xs focus:outline-none bg-white text-black font-mono";
const btnPrimary =
  "border-2 border-black bg-black text-white px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed font-mono";
const btnSecondary =
  "border-2 border-black bg-[var(--color-surface)] text-black px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-muted-bg)] font-mono";

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
        className="h-full flex items-center justify-center font-mono"
        style={{ background: "var(--color-background)" }}
      >
        <div className="text-center space-y-3">
          <p className="text-[var(--color-danger)] font-bold text-xs uppercase">{err}</p>
          <Link href="/" className="text-xs underline font-bold">Back to Kaya →</Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="h-full overflow-y-auto py-12 font-mono"
      style={{ background: "var(--color-background)" }}
    >
      <div className="max-w-3xl mx-auto px-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black uppercase tracking-tight">OAuth clients</h1>
          <Link href="/admin" className="text-xs font-bold underline">
            ← Admin
          </Link>
        </div>

        {/* Mint form */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Register a new client</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Manually-registered clients are an alternative to Dynamic Client Registration —
            use this when the integrating app can&apos;t discover the OAuth flow on its own.
            For Claude Desktop, DCR via <code className="bg-[var(--color-muted-bg)] px-1 border border-black">/.well-known/oauth-authorization-server</code> works automatically and you don&apos;t need to register here.
          </p>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder="e.g. Internal automation"
                className={`${inputClass} w-full`}
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider">
                Redirect URIs (one per line)
              </label>
              <textarea
                value={redirects}
                onChange={(e) => setRedirects(e.target.value)}
                disabled={busy}
                placeholder="http://localhost:7321/cb"
                rows={3}
                className={`${inputClass} w-full`}
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider">Client type</label>
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
                    <span className="text-[var(--color-muted)]">
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
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              {busy ? "Minting…" : "Register client"}
            </button>
            {err && <p className="text-xs text-[var(--color-danger)] font-bold">{err}</p>}
          </div>

          {created && <CreatedClientView created={created} onDismiss={() => setCreated(null)} />}
        </div>

        {/* List */}
        <div className={cardClass} style={cardStyle}>
          <h2 className={sectionHeading}>Registered clients</h2>
          {clients && clients.length === 0 && (
            <p className="text-xs text-[var(--color-muted)]">No manually-registered clients.</p>
          )}
          {clients && clients.length > 0 && (
            <table className="w-full text-xs border-2 border-black" style={{ borderRadius: "var(--border-radius)" }}>
              <thead>
                <tr className="border-b-2 border-black text-left" style={{ background: "var(--color-muted-bg)" }}>
                  <th className="font-bold px-3 py-2 uppercase">Name</th>
                  <th className="font-bold px-3 py-2 uppercase">Type</th>
                  <th className="font-bold px-3 py-2 uppercase">Redirect URIs</th>
                  <th className="font-bold px-3 py-2 uppercase">Created</th>
                  <th className="font-bold px-3 py-2 uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black">
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 px-3 font-bold break-all">{c.name}</td>
                    <td className="py-2 px-3 uppercase">{c.client_type}</td>
                    <td className="py-2 px-3 text-[var(--color-muted)] break-all">
                      {c.redirect_uris.join(", ")}
                    </td>
                    <td className="py-2 px-3 text-[var(--color-muted)]">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => revoke(c.id, c.name)}
                        className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] hover:underline"
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
    "border-2 border-black p-3 text-xs font-mono whitespace-pre-wrap break-all bg-[var(--color-muted-bg)]";

  return (
    <div
      className="border-2 border-[var(--color-accent)] p-4 space-y-3 mt-4"
      style={{ borderRadius: "var(--border-radius)", boxShadow: "4px 4px 0px var(--color-accent)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-xs uppercase tracking-wider text-black">
            Client created — copy now
          </p>
          {created.client_secret ? (
            <p className="text-xs text-[var(--color-muted)] mt-1">
              The client secret will not be shown again. Hand the ID + secret to the integrator out of band.
            </p>
          ) : (
            <p className="text-xs text-[var(--color-muted)] mt-1">
              Public client — no secret. The client authenticates with PKCE only.
            </p>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs font-bold uppercase tracking-wider underline"
        >
          Dismiss
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider">Client ID</span>
          <button onClick={() => copy(created.client_id)} className="text-xs font-bold underline">Copy</button>
        </div>
        <div className={snippet} style={{ borderRadius: "var(--border-radius)" }}>{created.client_id}</div>
      </div>

      {created.client_secret && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Client secret</span>
            <button onClick={() => copy(created.client_secret!)} className="text-xs font-bold underline">Copy</button>
          </div>
          <div className={snippet} style={{ borderRadius: "var(--border-radius)" }}>{created.client_secret}</div>
        </div>
      )}
    </div>
  );
}
