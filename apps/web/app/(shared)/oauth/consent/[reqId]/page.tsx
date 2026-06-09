"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
          const next = encodeURIComponent(
            window.location.pathname + window.location.search,
          );
          window.location.href = `/auth/signin?next=${next}`;
          return;
        }
        if (r.status === 404) {
          setError(
            "This consent request has expired or was already used. Restart the connection from your client.",
          );
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
      window.location.href = data.redirect;
    } catch {
      setError("Failed to reach the server.");
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <main className="h-full flex items-center justify-center px-6 bg-[var(--color-bg)]">
        <div className="bg-[var(--color-surface)] border border-[var(--color-danger)] rounded-[var(--radius-lg)] p-6 space-y-3 max-w-md w-full">
          <p className="font-[var(--font-serif)] text-xl font-semibold tracking-tight text-[var(--color-danger)]">
            Cannot complete connection
          </p>
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            {error}
          </p>
          <Link
            href="/"
            className="inline-block text-[var(--font-size-sm)] font-medium text-[var(--color-text)] underline underline-offset-2"
          >
            Back to Kaya
          </Link>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="h-full flex items-center justify-center bg-[var(--color-bg)]">
        <div className="w-full max-w-md space-y-3 px-6">
          <div className="h-5 w-40 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
          <div className="h-24 w-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
          <div className="h-3 w-3/4 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] animate-pulse" style={{ borderRadius: "var(--radius-md)" }} />
        </div>
      </main>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.floor((details.expires_at - Date.now()) / 60_000),
  );

  return (
    <main className="h-full flex items-center justify-center px-6 bg-[var(--color-bg)]">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-8 space-y-6 max-w-md w-full">
        <div className="space-y-2">
          <p className="text-[var(--font-size-xs)] tracking-wide text-[var(--color-text-subtle)]">
            Connection request
          </p>
          <h1 className="font-[var(--font-serif)] text-2xl font-semibold tracking-tight text-[var(--color-text)] leading-snug">
            <span className="italic">{details.client_name}</span> wants access to your Kaya knowledge base.
          </h1>
        </div>

        <div className="border border-[var(--color-border)] bg-[var(--color-bg-subtle)] rounded-[var(--radius-md)] p-4 text-[var(--font-size-sm)] space-y-2">
          <Row label="Scope" value={details.scope} />
          <Row
            label="Permissions"
            value="Read, propose changes, commit approved edits"
          />
          <Row label="Redirect" value={details.redirect_uri} mono />
          <Row label="Expires in" value={`${minutesLeft} min`} />
        </div>

        <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] leading-relaxed">
          Only allow if you initiated this connection from your MCP client (e.g.
          Claude Desktop). Tokens issued here can be revoked any time from
          Settings → Connected apps.
        </p>

        <div className="flex gap-3">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => decide("allow")}
            disabled={submitting}
          >
            {submitting ? "Working…" : "Allow"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="flex-1"
            onClick={() => decide("deny")}
            disabled={submitting}
          >
            Deny
          </Button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-text-subtle)] shrink-0">{label}</span>
      <span
        className={`text-[var(--color-text)] text-right break-all ${mono ? "font-[var(--font-mono)]" : "font-medium"}`}
      >
        {value}
      </span>
    </div>
  );
}
