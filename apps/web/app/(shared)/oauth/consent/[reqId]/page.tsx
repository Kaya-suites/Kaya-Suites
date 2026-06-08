"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface ConsentDetails {
  req_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scope: string;
  expires_at: number;
}

interface DecideResponse {
  redirect: string;
}

const cardStyle = {
  borderRadius: "var(--border-radius)",
  boxShadow: "var(--shadow-card)",
};

export default function ConsentPage({
  params,
}: {
  params: Promise<{ reqId: string }>;
}) {
  const { reqId } = use(params);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`${API_URL}/oauth/consent/${reqId}`, {
          credentials: "include",
        });
        if (r.status === 401) {
          // Bounce to sign-in, return here afterwards.
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/auth/signin?next=${next}`;
          return;
        }
        if (r.status === 404) {
          setError("This consent request has expired or was already used. Restart the connection from your client.");
          return;
        }
        if (!r.ok) {
          setError(`Failed to load consent request (HTTP ${r.status}).`);
          return;
        }
        setDetails(await r.json());
      } catch {
        setError("Failed to reach the server.");
      }
    }
    load();
  }, [reqId]);

  async function decide(decision: "allow" | "deny") {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/oauth/consent/${reqId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) {
        setError(`Decision failed (HTTP ${r.status}).`);
        setSubmitting(false);
        return;
      }
      const data: DecideResponse = await r.json();
      // The redirect URL points at the MCP client's callback (e.g. localhost).
      // Navigate there — the browser will surrender control to the client.
      window.location.href = data.redirect;
    } catch {
      setError("Failed to reach the server.");
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main
        className="h-full flex items-center justify-center font-mono px-6"
        style={{ background: "var(--color-background)" }}
      >
        <div
          className="bg-[var(--color-surface)] border-2 border-[var(--color-danger)] p-6 space-y-3 max-w-md"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "4px 4px 0px var(--color-danger)" }}
        >
          <p className="font-bold text-xs uppercase tracking-wider text-[var(--color-danger)]">
            Cannot complete connection
          </p>
          <p className="text-xs text-black">{error}</p>
          <Link href="/" className="text-xs font-bold underline">
            Back to Kaya
          </Link>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main
        className="h-full flex items-center justify-center font-mono"
        style={{ background: "var(--color-background)" }}
      >
        <p className="text-[var(--color-muted)] text-xs uppercase tracking-wider animate-pulse">
          Loading consent request…
        </p>
      </main>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.floor((details.expires_at - Date.now()) / 60_000),
  );

  return (
    <main
      className="h-full flex items-center justify-center font-mono px-6"
      style={{ background: "var(--color-background)" }}
    >
      <div
        className="bg-[var(--color-surface)] border-2 border-black p-8 space-y-6 max-w-md w-full"
        style={cardStyle}
      >
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Connection request
          </p>
          <h1 className="text-xl font-black tracking-tight text-black">
            <span className="underline">{details.client_name}</span> wants access
            to your Kaya knowledge base.
          </h1>
        </div>

        <div
          className="border-2 border-black p-4 text-xs space-y-2"
          style={{ background: "var(--color-muted-bg)", borderRadius: "var(--border-radius)" }}
        >
          <Row label="Scope" value={details.scope} />
          <Row
            label="Permissions"
            value="Read, propose changes, commit approved edits"
          />
          <Row label="Redirect" value={details.redirect_uri} mono />
          <Row label="Expires in" value={`${minutesLeft} min`} />
        </div>

        <p className="text-xs text-[var(--color-muted)]">
          Only allow if you initiated this connection from your MCP client (e.g.
          Claude Desktop). Tokens issued here can be revoked any time from
          Settings → Connected apps.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => decide("allow")}
            disabled={submitting}
            className="flex-1 border-2 border-black bg-black text-white px-4 py-3 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            {submitting ? "Working…" : "Allow"}
          </button>
          <button
            onClick={() => decide("deny")}
            disabled={submitting}
            className="flex-1 border-2 border-black bg-[var(--color-surface)] text-black px-4 py-3 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-muted)] uppercase tracking-wider shrink-0">
        {label}
      </span>
      <span
        className={`text-black text-right break-all ${mono ? "font-mono" : "font-bold"}`}
      >
        {value}
      </span>
    </div>
  );
}
