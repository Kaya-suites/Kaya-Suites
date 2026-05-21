"use client";

import Link from "next/link";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type State = "idle" | "loading" | "error";

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
        window.location.href = "/chat";
      } else {
        const body = await r.json().catch(() => ({}));
        setErrorMsg(
          body?.error === "invalid_credentials"
            ? "Invalid email or password."
            : "Something went wrong. Please try again."
        );
        setState("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
      setState("error");
    }
  }

  const inputClass = "w-full border-2 border-black px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)] bg-white text-black font-mono placeholder:text-[var(--color-muted)]";

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-background)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="font-bold text-sm tracking-wider text-black uppercase font-mono hover:text-[var(--color-accent)] transition-colors">
            Kaya Suites
          </Link>
        </div>

        <div
          className="bg-[var(--color-surface)] border-2 border-black p-8"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
        >
          <h1 className="font-bold text-black mb-1 uppercase tracking-wider text-sm font-mono">Sign in</h1>
          <p className="text-xs text-[var(--color-muted)] mb-6 font-mono">Enter your email and password to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-black mb-1.5 font-mono">
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
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-black mb-1.5 font-mono">
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
              <p className="text-xs text-[var(--color-danger)] font-mono font-bold">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={state === "loading" || !email.trim() || !password}
              className="w-full border-2 border-black bg-[var(--color-accent)] text-white py-2.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              {state === "loading" ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--color-muted)] mt-6 font-mono">
          New here?{" "}
          <Link href="/auth/signup" className="font-bold text-black underline hover:text-[var(--color-accent)]">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
