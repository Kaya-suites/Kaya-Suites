import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kaya Suites — Docs that keep themselves current",
  description:
    "AI-native knowledge base that detects stale content, proposes edits, and learns from your team's decisions.",
};

const navLinkClass = "text-xs font-bold uppercase tracking-wider text-black hover:text-[var(--color-accent)] transition-colors font-mono";

export default function LandingPage() {
  return (
    <div className="min-h-screen font-mono" style={{ background: "var(--color-background)", color: "var(--color-foreground)" }}>
      {/* Nav */}
      <nav className="border-b-2 border-black px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-sm tracking-wider uppercase">Kaya Suites</span>
        <div className="flex items-center gap-6">
          <Link href="/pricing" className={navLinkClass}>Pricing</Link>
          <a href="https://github.com/kaya-suites/kaya-suites" className={navLinkClass} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link href="/auth/signup" className={navLinkClass}>Sign up</Link>
          <Link
            href="/auth/signin"
            className="border-2 border-black bg-black text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all font-mono"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-block border-2 border-black px-3 py-1 text-xs font-bold uppercase tracking-wider mb-6 bg-[var(--color-accent)] text-white" style={{ borderRadius: "var(--border-radius)" }}>
          AI-Native Knowledge Base
        </div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter leading-tight mb-6 uppercase">
          Docs that keep<br />themselves current.
        </h1>
        <p className="text-base text-[var(--color-muted)] leading-relaxed max-w-2xl mx-auto mb-10 font-mono">
          Kaya Suites detects stale content, proposes precise edits, and shows you a diff before anything changes — so your documentation stays accurate without becoming a second job.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/auth/signup"
            className="border-2 border-black bg-[var(--color-accent)] text-white px-8 py-3.5 font-bold uppercase tracking-wider text-sm hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Start for $10 / month
          </Link>
          <a
            href="https://github.com/kaya-suites/kaya-suites/releases"
            className="border-2 border-black bg-[var(--color-surface)] text-black px-8 py-3.5 font-bold uppercase tracking-wider text-sm hover:bg-[var(--color-muted-bg)] transition-all"
            target="_blank"
            rel="noreferrer"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Download OSS binary ↗
          </a>
        </div>
        <p className="mt-4 text-xs text-[var(--color-muted)] font-mono">
          30-day money-back guarantee · OSS self-hosted is free forever
        </p>
      </section>

      {/* How it works */}
      <section className="border-y-2 border-black py-20" style={{ background: "var(--color-surface)" }}>
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-14 uppercase tracking-tight">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-0 border-2 border-black" style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
            {[
              {
                step: "01",
                title: "Import your docs",
                body: "Connect your Markdown files or paste content directly. Kaya indexes every paragraph for semantic search.",
              },
              {
                step: "02",
                title: "AI detects drift",
                body: "When facts become stale — a version number, a changed API, an outdated process — Kaya surfaces the paragraph and explains why.",
              },
              {
                step: "03",
                title: "You approve, not rubber-stamp",
                body: "Every edit arrives as a diff. Accept, reject, or refine. Nothing merges without your explicit approval.",
              },
            ].map(({ step, title, body }, i) => (
              <div key={step} className={`p-8 ${i < 2 ? "border-r-2 border-black" : ""}`}>
                <div className="text-xs font-mono font-bold text-[var(--color-accent)] mb-3 uppercase tracking-wider">{step}</div>
                <h3 className="font-black text-sm uppercase tracking-wider mb-3">{title}</h3>
                <p className="text-[var(--color-muted)] leading-relaxed text-xs">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-black mb-4 uppercase tracking-tight">Simple pricing</h2>
        <p className="text-[var(--color-muted)] mb-12 text-xs uppercase tracking-wider">
          One plan. Everything included. Or self-host for free.
        </p>
        <div className="flex flex-col sm:flex-row gap-6 justify-center">
          <div
            className="flex-1 max-w-sm border-2 border-black p-8 text-left bg-[var(--color-surface)]"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="text-xs font-bold text-[var(--color-muted)] mb-4 uppercase tracking-wider">Cloud</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-5xl font-black">$10</span>
              <span className="text-[var(--color-muted)] text-sm font-mono">/ month</span>
            </div>
            <ul className="space-y-2.5 text-xs text-black mb-8 font-mono">
              {[
                "50 agent invocations / month",
                "Unlimited documents",
                "1 GB storage",
                "Semantic + full-text search",
                "30-day money-back guarantee",
                "Automatic backups",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="text-[var(--color-accent)] font-bold mt-px">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/signup"
              className="w-full block text-center border-2 border-black bg-[var(--color-accent)] text-white py-3 font-bold uppercase tracking-wider text-xs font-mono hover:bg-black transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Get started
            </Link>
          </div>

          <div
            className="flex-1 max-w-sm border-2 border-black p-8 text-left bg-[var(--color-surface)]"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="text-xs font-bold text-[var(--color-muted)] mb-4 uppercase tracking-wider">Open Source</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-5xl font-black">Free</span>
            </div>
            <ul className="space-y-2.5 text-xs text-black mb-8 font-mono">
              {[
                "Single binary, zero dependencies",
                "Bring your own API keys",
                "Local SQLite storage",
                "Full source on GitHub (Apache 2.0)",
                "Community support",
                "No usage limits",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="text-[var(--color-muted)] font-bold mt-px">✓</span> {f}
                </li>
              ))}
            </ul>
            <a
              href="https://github.com/kaya-suites/kaya-suites/releases"
              target="_blank"
              rel="noreferrer"
              className="w-full block text-center border-2 border-black bg-[var(--color-surface)] text-black py-3 font-bold uppercase tracking-wider text-xs font-mono hover:bg-[var(--color-muted-bg)] transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Download binary ↗
            </a>
          </div>
        </div>
        <p className="mt-6 text-xs text-[var(--color-muted)] font-mono">
          <Link href="/pricing" className="underline font-bold text-black hover:text-[var(--color-accent)]">Full pricing details →</Link>
        </p>
      </section>

      {/* FAQ */}
      <section className="border-t-2 border-black py-20" style={{ background: "var(--color-surface)" }}>
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-12 uppercase tracking-tight">FAQ</h2>
          <div className="space-y-0 border-2 border-black" style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
            {[
              {
                q: "What counts as an agent invocation?",
                a: "One chat message that triggers the AI loop — typically an edit proposal or document generation. Search and retrieval are not counted.",
              },
              {
                q: "Is there a free trial?",
                a: "No free trial — but there is a 30-day money-back guarantee. You can also self-host the OSS binary indefinitely with your own API keys.",
              },
              {
                q: "How does the OSS version differ from cloud?",
                a: "OSS includes the full document management and AI editing loop. Cloud adds multi-device sync, automatic backups, managed Postgres, and the billing/auth layer.",
              },
              {
                q: "What AI models does Kaya use?",
                a: "Claude Opus for edit proposals; GPT-4o-mini for retrieval classification; text-embedding-3-small for semantic search. Bring your own keys in OSS.",
              },
              {
                q: "Is my data used to train AI models?",
                a: "No. We use Anthropic and OpenAI APIs in zero-data-retention mode.",
              },
            ].map(({ q, a }, i) => (
              <div key={q} className={`px-6 py-5 ${i < 4 ? "border-b-2 border-black" : ""}`}>
                <h3 className="font-bold text-xs uppercase tracking-wider mb-2">{q}</h3>
                <p className="text-[var(--color-muted)] leading-relaxed text-xs">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-black py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--color-muted)] font-mono uppercase tracking-wider">
          <span>© {new Date().getFullYear()} Kaya Suites</span>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-black transition-colors">Pricing</Link>
            <Link href="/privacy" className="hover:text-black transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-black transition-colors">Terms</Link>
            <a href="https://github.com/kaya-suites/kaya-suites" target="_blank" rel="noreferrer" className="hover:text-black transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
