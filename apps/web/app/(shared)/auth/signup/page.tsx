"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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

const mobileBullets = [
  "50 agent invocations / month",
  "Unlimited documents",
  "Semantic + full-text search",
  "Automatic backups",
];

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setState("loading");
    setErrorMsg("");

    try {
      const body: Record<string, string> = { email: email.trim(), password };
      if (username.trim()) body.username = username.trim();

      const r = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (r.ok) {
        window.location.href = "/chat";
      } else {
        const data = await r.json().catch(() => ({}));
        if (data?.error === "email_already_exists") {
          setErrorMsg("An account with that email already exists.");
        } else if (data?.error === "username_taken") {
          setErrorMsg("That username is already taken.");
        } else {
          setErrorMsg("Something went wrong. Please try again.");
        }
        setState("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
      setState("error");
    }
  }

  return (
    <main className="min-h-screen flex bg-[var(--color-bg)] text-[var(--color-text)]">
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
              Create your account
            </h2>
            <p className="mt-1 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              Start for{" "}
              <span className="font-semibold text-[var(--color-text)]">$10 / month</span>
              {" "}— 30-day money-back guarantee.
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

            <Field label="Username" hint="Optional">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="yourhandle"
                  autoComplete="username"
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
                  autoComplete="new-password"
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
              {state === "loading" ? "Creating account…" : "Get started"}
            </Button>
          </form>

          <ul className="lg:hidden mt-8 pt-6 border-t border-[var(--color-border)] space-y-2">
            {mobileBullets.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]"
              >
                <Check size={14} className="mt-0.5 shrink-0 text-[var(--color-text)]" />
                {f}
              </li>
            ))}
          </ul>

          <p className="text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)] mt-8">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="font-medium text-[var(--color-text)] underline underline-offset-2 hover:text-[var(--color-text-muted)]"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
