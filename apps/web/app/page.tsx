import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kaya Suites — Your AI agent for documentation",
  description:
    "Agentic retrieval and editing tools that keep your knowledge base accurate. Built for startup teams that can't afford stale docs.",
};

const navLinkClass =
  "text-xs font-bold uppercase tracking-wider text-black hover:text-[var(--color-accent)] transition-colors font-mono";

export default function LandingPage() {
  return (
    <div
      className="min-h-screen font-mono"
      style={{ background: "var(--color-background)", color: "var(--color-foreground)" }}
    >
      {/* Nav */}
      <nav className="border-b-2 border-black px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-sm tracking-wider uppercase">Kaya Suites</span>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/kaya-suites/kaya-suites"
            className={navLinkClass}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
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
        <div
          className="inline-block border-2 border-black px-3 py-1 text-xs font-bold uppercase tracking-wider mb-6 bg-[var(--color-accent)] text-white"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          Agentic knowledge base
        </div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter leading-tight mb-6 uppercase">
          Stop maintaining docs.<br />Let the agent do it.
        </h1>
        <p className="text-base text-[var(--color-muted)] leading-relaxed max-w-2xl mx-auto mb-10 font-mono">
          Kaya gives your startup an AI agent that retrieves the right context, detects when facts go stale, and proposes
          precise edits — so your team ships on accurate information, not outdated wikis.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/auth/signup"
            className="border-2 border-black bg-[var(--color-accent)] text-white px-8 py-3.5 font-bold uppercase tracking-wider text-sm hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Get started free →
          </Link>
          <a
            href="https://github.com/kaya-suites/kaya-suites"
            className="border-2 border-black bg-[var(--color-surface)] text-black px-8 py-3.5 font-bold uppercase tracking-wider text-sm hover:bg-[var(--color-muted-bg)] transition-all"
            target="_blank"
            rel="noreferrer"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            View on GitHub ↗
          </a>
        </div>
        <p className="mt-4 text-xs text-[var(--color-muted)] font-mono">
          No credit card required · OSS self-hosted is free forever
        </p>
      </section>

      {/* Social proof strip */}
      <section className="border-y-2 border-black py-6" style={{ background: "var(--color-surface)" }}>
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-center gap-8 text-xs text-[var(--color-muted)] uppercase tracking-widest font-bold">
          <span>✓ Agentic retrieval</span>
          <span className="hidden sm:inline text-black">·</span>
          <span>✓ AI-proposed edits</span>
          <span className="hidden sm:inline text-black">·</span>
          <span>✓ You approve every change</span>
          <span className="hidden sm:inline text-black">·</span>
          <span>✓ Minimized hallucinations</span>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-4 uppercase tracking-tight">How it works</h2>
          <p className="text-center text-xs text-[var(--color-muted)] uppercase tracking-widest mb-14">
            Three steps. No babysitting required.
          </p>
          <div
            className="grid sm:grid-cols-3 gap-0 border-2 border-black"
            style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}
          >
            {[
              {
                step: "01",
                title: "Import your docs",
                body: "Connect your Markdown files or paste content directly. Kaya indexes every paragraph for semantic retrieval.",
              },
              {
                step: "02",
                title: "Agent detects drift",
                body: "When a version number changes, an API shifts, or a process evolves — Kaya's agent finds the stale paragraph and explains exactly why.",
              },
              {
                step: "03",
                title: "You approve, not rubber-stamp",
                body: "Every edit arrives as a diff. Accept, reject, or refine. Nothing merges without your explicit sign-off.",
              },
            ].map(({ step, title, body }, i) => (
              <div
                key={step}
                className={`p-8 ${i < 2 ? "border-r-2 border-black" : ""}`}
                style={{ background: "var(--color-surface)" }}
              >
                <div className="text-xs font-mono font-bold text-[var(--color-accent)] mb-3 uppercase tracking-wider">
                  {step}
                </div>
                <h3 className="font-black text-sm uppercase tracking-wider mb-3">{title}</h3>
                <p className="text-[var(--color-muted)] leading-relaxed text-xs">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature callouts */}
      <section className="border-t-2 border-black py-20" style={{ background: "var(--color-surface)" }}>
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-14 uppercase tracking-tight">
            Built for teams that move fast
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                icon: "⚡",
                title: "Semantic retrieval agent",
                body: "Ask questions in plain English. The agent searches by meaning, not just keywords — pulling the right context from across your entire knowledge base.",
              },
              {
                icon: "✏️",
                title: "Precise, scoped edits",
                body: "No rewrites, no hallucinated rewording. The agent proposes surgical changes to exactly the paragraph that's wrong.",
              },
              {
                icon: "🔍",
                title: "Full-text + vector search",
                body: "Hybrid search combines keyword matching with semantic embeddings so nothing slips through the cracks.",
              },
              {
                icon: "🔒",
                title: "Your data stays yours",
                body: "Zero-data-retention mode on all AI providers. OSS binary available — bring your own API keys and run it anywhere.",
              },
            ].map(({ icon, title, body }) => (
              <div
                key={title}
                className="border-2 border-black p-6"
                style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)", background: "var(--color-background)" }}
              >
                <div className="text-2xl mb-3">{icon}</div>
                <h3 className="font-black text-xs uppercase tracking-wider mb-2">{title}</h3>
                <p className="text-[var(--color-muted)] text-xs leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="border-t-2 border-black py-20">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-black uppercase tracking-tighter mb-4">
            Your docs are already stale.
          </h2>
          <p className="text-[var(--color-muted)] text-sm mb-8 leading-relaxed">
            Every day you ship without accurate documentation, your team pays the cost in context-switching, wrong decisions, and onboarding time. Kaya fixes that.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block border-2 border-black bg-[var(--color-accent)] text-white px-10 py-4 font-bold uppercase tracking-wider text-sm hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Get started free →
          </Link>
          <p className="mt-4 text-xs text-[var(--color-muted)]">No credit card required</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t-2 border-black py-20" style={{ background: "var(--color-surface)" }}>
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-12 uppercase tracking-tight">FAQ</h2>
          <div
            className="space-y-0 border-2 border-black"
            style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}
          >
            {[
              {
                q: "What exactly does the agent do?",
                a: "It retrieves relevant paragraphs using semantic search, identifies content that has drifted from the current state of your product or codebase, and proposes a precise diff. You review and approve — the agent never edits without your sign-off.",
              },
              {
                q: "How does it know when something is stale?",
                a: "You tell it what changed — paste a changelog, a PR description, or a Slack message — and the agent finds every paragraph in your docs that contradicts or omits the new information.",
              },
              {
                q: "How does the OSS version differ from cloud?",
                a: "OSS includes the full agentic retrieval and editing loop with local SQLite storage. Cloud adds multi-device sync, managed Postgres, automatic backups, and the hosted auth layer.",
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
            <Link href="/privacy" className="hover:text-black transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-black transition-colors">
              Terms
            </Link>
            <a
              href="https://github.com/kaya-suites/kaya-suites"
              target="_blank"
              rel="noreferrer"
              className="hover:text-black transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
