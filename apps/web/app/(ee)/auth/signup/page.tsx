"use client";

import Link from "next/link";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type State = "idle" | "loading" | "error";

const features = [
  {
    icon: "⚡",
    title: "AI detects stale content",
    body: "Kaya scans your docs and surfaces outdated paragraphs before your users do.",
  },
  {
    icon: "✏️",
    title: "Propose-then-approve edits",
    body: "Every AI suggestion arrives as a diff. Nothing merges without your explicit sign-off.",
  },
  {
    icon: "🔍",
    title: "Semantic + full-text search",
    body: "Find anything across your knowledge base instantly, by concept or keyword.",
  },
  {
    icon: "🔒",
    title: "Your data, your keys",
    body: "OSS self-hosted or cloud — zero-data-retention mode on all AI providers.",
  },
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

  const inputClass =
    "w-full border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)] bg-white text-black font-mono placeholder:text-[var(--color-muted)]";

  return (
    <main className="min-h-screen flex font-mono" style={{ background: "var(--color-background)" }}>
      {/* Left — features panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 border-r-2 border-black p-12"
        style={{ background: "var(--color-surface)" }}
      >
        <div>
          <Link
            href="/"
            className="inline-block font-black text-lg tracking-tighter uppercase hover:text-[var(--color-accent)] transition-colors"
          >
            Kaya Suites
          </Link>
          <div
            className="inline-block ml-3 border-2 border-black bg-[var(--color-accent)] text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 align-middle"
            style={{ borderRadius: "var(--border-radius)" }}
          >
            AI-Native
          </div>

          <p className="mt-6 text-2xl font-black uppercase tracking-tight leading-tight">
            Docs that keep<br />themselves current.
          </p>
          <p className="mt-3 text-xs text-[var(--color-muted)] leading-relaxed max-w-xs">
            The knowledge base that detects drift, proposes edits, and waits for your approval before touching anything.
          </p>
        </div>

        <div className="space-y-0 border-2 border-black" style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
          {features.map(({ icon, title, body }, i) => (
            <div
              key={title}
              className={`flex gap-4 p-5 ${i < features.length - 1 ? "border-b-2 border-black" : ""}`}
            >
              <span className="text-xl shrink-0 mt-0.5">{icon}</span>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider mb-1">{title}</h3>
                <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">
          30-day money-back · OSS self-hosted is free forever
        </p>
      </div>

      {/* Right — sign-up form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <Link href="/" className="font-black text-lg tracking-tighter uppercase hover:text-[var(--color-accent)] transition-colors">
            Kaya Suites
          </Link>
        </div>

        <div className="w-full max-w-sm">
          <div
            className="bg-[var(--color-surface)] border-2 border-black p-8"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <h1 className="font-black text-black mb-1 uppercase tracking-wider text-base">Create your account</h1>
            <p className="text-xs text-[var(--color-muted)] mb-6">
              Start for{" "}
              <span className="font-bold text-black">$10 / month</span>
              {" "}— 30-day money-back guarantee.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-black mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className={inputClass}
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                />
              </div>

              <div>
                <label htmlFor="username" className="block text-xs font-bold uppercase tracking-wider text-black mb-1.5">
                  Username{" "}
                  <span className="text-[var(--color-muted)] normal-case font-normal">(optional)</span>
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="yourhandle"
                  className={inputClass}
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-black mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className={inputClass}
                  style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-input)" }}
                />
              </div>

              {state === "error" && (
                <p className="text-xs text-[var(--color-danger)] font-bold">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={state === "loading" || !email.trim() || !password}
                className="w-full border-2 border-black bg-[var(--color-accent)] text-white py-3 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
              >
                {state === "loading" ? "Creating account…" : "Get started →"}
              </button>
            </form>

            {/* Inline feature summary for mobile */}
            <ul className="lg:hidden mt-6 pt-6 border-t-2 border-black space-y-2">
              {["50 agent invocations / month", "Unlimited documents", "Semantic + full-text search", "Automatic backups"].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[10px] text-[var(--color-muted)]">
                  <span className="text-[var(--color-accent)] font-bold">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-center text-xs text-[var(--color-muted)] mt-6">
            Already have an account?{" "}
            <Link href="/auth/signin" className="font-bold text-black underline hover:text-[var(--color-accent)]">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
