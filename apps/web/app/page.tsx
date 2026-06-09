import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Kaya Suites — Your AI agent for documentation",
  description:
    "Agentic retrieval and editing tools that keep your knowledge base accurate. Built for startup teams that can't afford stale docs.",
};

const steps = [
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
];

const features = [
  {
    title: "Semantic retrieval agent",
    body: "Ask questions in plain English. The agent searches by meaning, not keywords — pulling the right context from across your entire knowledge base.",
  },
  {
    title: "Precise, scoped edits",
    body: "No rewrites, no hallucinated rewording. The agent proposes surgical changes to exactly the paragraph that's wrong.",
  },
  {
    title: "Full-text + vector search",
    body: "Hybrid search combines keyword matching with semantic embeddings so nothing slips through the cracks.",
  },
  {
    title: "Your data stays yours",
    body: "Zero-data-retention mode on all AI providers. OSS binary available — bring your own keys and run it anywhere.",
  },
];

const faqs = [
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
];

const guarantees = [
  "Agentic retrieval",
  "AI-proposed edits",
  "You approve every change",
  "Minimized hallucinations",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Nav */}
      <nav className="border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-[var(--font-serif)] text-base font-semibold tracking-tight">
            Kaya Suites
          </span>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/kaya-suites/kaya-suites"
              className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <Link href="/auth/signin">
              <Button variant="secondary" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-28 pb-24 text-center">
        <p className="text-[var(--font-size-sm)] text-[var(--color-text-muted)] mb-6 tracking-wide">
          An agentic knowledge base
        </p>
        <h1 className="font-[var(--font-serif)] text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.05] mb-8">
          Stop maintaining docs.<br />
          <span className="italic text-[var(--color-text-muted)]">Let the agent do it.</span>
        </h1>
        <p className="text-[var(--font-size-lg)] text-[var(--color-text-muted)] leading-relaxed max-w-2xl mx-auto mb-12">
          Kaya gives your startup an AI agent that retrieves the right context,
          detects when facts go stale, and proposes precise edits — so your team
          ships on accurate information, not outdated wikis.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/auth/signup">
            <Button size="lg">Get started free</Button>
          </Link>
          <a
            href="https://github.com/kaya-suites/kaya-suites"
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="secondary" size="lg">
              View on GitHub
              <ArrowUpRight size={16} />
            </Button>
          </a>
        </div>
        <p className="mt-6 text-[var(--font-size-sm)] text-[var(--color-text-subtle)]">
          No credit card required · OSS self-hosted is free forever
        </p>
      </section>

      {/* Guarantee strip */}
      <section className="border-y border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
        <div className="max-w-5xl mx-auto px-6 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
          {guarantees.map((g) => (
            <span key={g} className="inline-flex items-center gap-1.5">
              <Check size={14} className="text-[var(--color-text)]" />
              {g}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="font-[var(--font-serif)] text-4xl font-semibold tracking-tight mb-3">
              How it works
            </h2>
            <p className="text-[var(--font-size-base)] text-[var(--color-text-muted)]">
              Three steps. No babysitting required.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-10">
            {steps.map(({ step, title, body }) => (
              <div key={step} className="border-t border-[var(--color-border-strong)] pt-6">
                <div className="font-[var(--font-mono)] text-[var(--font-size-sm)] text-[var(--color-text-subtle)] mb-3">
                  {step}
                </div>
                <h3 className="font-[var(--font-serif)] text-xl font-semibold tracking-tight mb-2">
                  {title}
                </h3>
                <p className="text-[var(--font-size-base)] text-[var(--color-text-muted)] leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface)] py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="font-[var(--font-serif)] text-4xl font-semibold tracking-tight text-center mb-16">
            Built for teams that move fast
          </h2>
          <div className="grid sm:grid-cols-2 gap-x-12 gap-y-12">
            {features.map(({ title, body }) => (
              <div key={title}>
                <h3 className="font-[var(--font-serif)] text-2xl font-semibold tracking-tight mb-2">
                  {title}
                </h3>
                <p className="text-[var(--font-size-base)] text-[var(--color-text-muted)] leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="border-t border-[var(--color-border)] py-24">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="font-[var(--font-serif)] text-5xl font-semibold tracking-tight mb-6 leading-[1.1]">
            Your docs are<br />
            <span className="italic text-[var(--color-text-muted)]">already stale.</span>
          </h2>
          <p className="text-[var(--font-size-lg)] text-[var(--color-text-muted)] mb-10 leading-relaxed">
            Every day you ship without accurate documentation, your team pays the
            cost in context-switching, wrong decisions, and onboarding time. Kaya
            fixes that.
          </p>
          <Link href="/auth/signup">
            <Button size="lg">Get started free</Button>
          </Link>
          <p className="mt-4 text-[var(--font-size-sm)] text-[var(--color-text-subtle)]">
            No credit card required
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface)] py-24">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="font-[var(--font-serif)] text-4xl font-semibold tracking-tight text-center mb-12">
            Frequently asked
          </h2>
          <dl className="divide-y divide-[var(--color-border)]">
            {faqs.map(({ q, a }) => (
              <div key={q} className="py-6">
                <dt className="font-[var(--font-serif)] text-lg font-semibold tracking-tight mb-2">
                  {q}
                </dt>
                <dd className="text-[var(--font-size-base)] text-[var(--color-text-muted)] leading-relaxed">
                  {a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
          <span>© {new Date().getFullYear()} Kaya Suites</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-[var(--color-text)] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--color-text)] transition-colors">
              Terms
            </Link>
            <a
              href="https://github.com/kaya-suites/kaya-suites"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--color-text)] transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
