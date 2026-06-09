"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function safeNextOrDefault(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return fallback;
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : fallback;
  } catch {
    return fallback;
  }
}

type State = "idle" | "loading" | "error";

const features = [
  {
    title: "Detects stale content",
    body: "Kaya surfaces outdated paragraphs before your users do.",
  },
  {
    title: "Propose-then-approve edits",
    body: "Every AI suggestion arrives as a diff. Nothing merges without sign-off.",
  },
  {
    title: "Semantic + full-text search",
    body: "Find anything across your knowledge base, by concept or keyword.",
  },
  {
    title: "Your data, your keys",
    body: "OSS self-hosted or cloud — zero-data-retention on all AI providers.",
  },
];

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setState("loading");
    setErrorMsg("");

    try {
      const r = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (r.ok) {
        window.location.href = safeNextOrDefault("/chat");
      } else {
        const body = await r.json().catch(() => ({}));
        setErrorMsg(
          body?.error === "invalid_credentials"
            ? "Invalid email or password."
            : "Something went wrong. Please try again.",
        );
        setState("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
      setState("error");
    }
  }

  return (
    <main className="min-h-screen flex bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Left — editorial features panel */}
      <aside className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-12">
        <div>
          <Link
            href="/"
            className="font-[var(--font-serif)] text-xl font-semibold tracking-tight hover:text-[var(--color-text-muted)] transition-colors"
          >
            Kaya Suites
          </Link>

          <h1 className="mt-12 font-[var(--font-serif)] text-4xl font-semibold tracking-tight leading-[1.1]">
            Docs that keep<br />themselves current.
          </h1>
          <p className="mt-4 text-[var(--font-size-base)] text-[var(--color-text-muted)] leading-relaxed max-w-sm">
            The knowledge base that detects drift, proposes edits, and waits for
            your approval before touching anything.
          </p>
        </div>

        <ul className="space-y-5 mt-10">
          {features.map(({ title, body }) => (
            <li key={title} className="border-l border-[var(--color-border-strong)] pl-4">
              <h3 className="text-[var(--font-size-sm)] font-semibold">{title}</h3>
              <p className="mt-0.5 text-[var(--font-size-sm)] text-[var(--color-text-muted)] leading-relaxed">
                {body}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-[var(--font-size-xs)] text-[var(--color-text-subtle)]">
          30-day money-back · OSS self-hosted is free forever
        </p>
      </aside>

      {/* Right — sign-in form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="lg:hidden mb-8 text-center">
          <Link
            href="/"
            className="font-[var(--font-serif)] text-xl font-semibold tracking-tight"
          >
            Kaya Suites
          </Link>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="font-[var(--font-serif)] text-2xl font-semibold tracking-tight">
              Welcome back
            </h2>
            <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              Enter your credentials to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label="Email address" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  autoComplete="email"
                />
              )}
            </Field>

            <Field label="Password" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              )}
            </Field>

            {state === "error" && (
              <p className="text-[var(--font-size-sm)] text-[var(--color-danger)]" role="alert">
                {errorMsg}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={state === "loading" || !email.trim() || !password}
              className="w-full"
            >
              {state === "loading" ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)] mt-8">
            New here?{" "}
            <Link
              href="/auth/signup"
              className="font-medium text-[var(--color-text)] underline underline-offset-2 hover:text-[var(--color-text-muted)]"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
