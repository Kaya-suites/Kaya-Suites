import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Kaya Suites",
  description: "One cloud plan at $10/month. Or self-host the OSS binary for free.",
};

const navLinkClass = "text-xs font-bold uppercase tracking-wider text-black hover:text-[var(--color-accent)] transition-colors font-mono";

export default function PricingPage() {
  return (
    <div className="min-h-screen font-mono" style={{ background: "var(--color-background)", color: "var(--color-foreground)" }}>
      <nav className="border-b-2 border-black px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="font-bold text-sm tracking-wider uppercase hover:text-[var(--color-accent)] transition-colors">Kaya Suites</Link>
        <div className="flex items-center gap-6">
          <Link href="/pricing" className={`${navLinkClass} text-[var(--color-accent)]`}>Pricing</Link>
          <a href="https://github.com/kaya-suites/kaya-suites" className={navLinkClass} target="_blank" rel="noreferrer">GitHub</a>
          <Link href="/auth/signup" className={navLinkClass}>Sign up</Link>
          <Link
            href="/auth/signin"
            className="border-2 border-black bg-black text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
          >
            Sign in
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-black tracking-tighter mb-4 uppercase">Simple pricing</h1>
          <p className="text-sm text-[var(--color-muted)] max-w-xl mx-auto">
            One cloud plan, everything included. Or download the OSS binary and self-host for free.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-8 mb-20">
          <div className="border-2 border-black p-8 bg-[var(--color-surface)]" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
            <div className="text-xs font-bold text-[var(--color-muted)] mb-2 uppercase tracking-wider">Cloud</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-6xl font-black">$10</span>
              <span className="text-[var(--color-muted)] text-sm">/ month</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-8">Per workspace. Cancel any time.</p>

            <Link
              href="/auth/signup"
              className="block w-full text-center border-2 border-black bg-[var(--color-accent)] text-white py-3 font-bold uppercase tracking-wider text-xs mb-8 hover:bg-black transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Get started
            </Link>

            <div className="space-y-3 text-xs text-black">
              <FeatureRow label="Agent invocations" value="50 / month" />
              <FeatureRow label="Documents" value="Unlimited" />
              <FeatureRow label="Storage" value="1 GB" />
              <FeatureRow label="Semantic + full-text search" value="Included" />
              <FeatureRow label="Automatic backups" value="Daily" />
              <FeatureRow label="Multi-device sync" value="Included" />
              <FeatureRow label="Managed Postgres" value="Included" />
              <FeatureRow label="Money-back guarantee" value="30 days" />
              <FeatureRow label="Support" value="Email" />
              <FeatureRow label="Overage invocations" value="$0.10 each" note />
            </div>
          </div>

          <div className="border-2 border-black p-8 bg-[var(--color-surface)]" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
            <div className="text-xs font-bold text-[var(--color-muted)] mb-2 uppercase tracking-wider">Open Source</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-6xl font-black">Free</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] mb-8">Forever. Apache 2.0. Bring your own keys.</p>

            <a
              href="https://github.com/kaya-suites/kaya-suites/releases"
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center border-2 border-black bg-[var(--color-surface)] text-black py-3 font-bold uppercase tracking-wider text-xs mb-8 hover:bg-[var(--color-muted-bg)] transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Download binary ↗
            </a>

            <div className="space-y-3 text-xs text-black">
              <FeatureRow label="Agent invocations" value="Unlimited" />
              <FeatureRow label="Documents" value="Unlimited" />
              <FeatureRow label="Storage" value="Disk only" />
              <FeatureRow label="Semantic + full-text search" value="Included" />
              <FeatureRow label="Automatic backups" value="Manual" />
              <FeatureRow label="Multi-device sync" value="Not included" faded />
              <FeatureRow label="Managed Postgres" value="Not included" faded />
              <FeatureRow label="Money-back guarantee" value="N/A" faded />
              <FeatureRow label="Support" value="Community" />
              <FeatureRow label="API keys" value="Your own" />
            </div>
          </div>
        </div>

        <section className="mb-20">
          <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">What counts as an invocation?</h2>
          <div className="border-2 border-black p-6 bg-[var(--color-surface)] text-xs text-black space-y-3 leading-relaxed" style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}>
            <p>An agent invocation is one round-trip through the AI editing loop. These operations count:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Edit proposal</strong> — AI detects a stale paragraph and generates a suggested rewrite.</li>
              <li><strong>Document generation</strong> — AI drafts a new document from a prompt or template.</li>
            </ul>
            <p>These do <strong>not</strong> count: search queries, embedding generation, staleness classification, viewing/editing documents manually.</p>
          </div>
        </section>

        <section className="mb-20">
          <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">AI cost model</h2>
          <div
            className="border-2 border-black overflow-hidden bg-[var(--color-surface)]"
            style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-black text-left" style={{ background: "var(--color-muted-bg)" }}>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider">Operation</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider">Model</th>
                  <th className="px-5 py-3 text-right font-bold uppercase tracking-wider">Typical cost</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black">
                {[
                  { op: "Edit proposal", model: "Claude Opus", cost: "~$0.09" },
                  { op: "Document generation", model: "Claude Opus", cost: "~$0.09" },
                  { op: "Staleness classification", model: "GPT-4o-mini", cost: "~$0.0003" },
                  { op: "Semantic search (import)", model: "text-embedding-3-small", cost: "~$0.000002 / doc" },
                ].map((r) => (
                  <tr key={r.op}>
                    <td className="px-5 py-3 font-bold">{r.op}</td>
                    <td className="px-5 py-3 text-[var(--color-muted)] font-mono">{r.model}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold">{r.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-20">
          <h2 className="text-2xl font-black mb-8 uppercase tracking-tight">Pricing FAQ</h2>
          <div className="space-y-0 border-2 border-black max-w-2xl" style={{ borderRadius: "var(--border-radius)", overflow: "hidden", boxShadow: "var(--shadow-card)", background: "var(--color-surface)" }}>
            {[
              { q: "Is there a free trial?", a: "No free trial — we offer a 30-day money-back guarantee instead." },
              { q: "What if I hit the 50-invocation limit?", a: "Subsequent invocations are billed at $0.10 each. We don't hard-block you." },
              { q: "Do unused invocations roll over?", a: "No. The 50 included invocations reset on the first day of each billing period." },
              { q: "Is the cloud plan available globally?", a: "Yes. Paddle handles tax collection (VAT, GST) automatically. All prices in USD." },
            ].map(({ q, a }, i) => (
              <div key={q} className={`px-6 py-5 ${i < 3 ? "border-b-2 border-black" : ""}`}>
                <h3 className="font-bold text-xs uppercase tracking-wider mb-2">{q}</h3>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="text-center border-t-2 border-black pt-16">
          <h2 className="text-2xl font-black mb-4 uppercase tracking-tight">Ready to keep your docs current?</h2>
          <p className="text-[var(--color-muted)] mb-8 text-xs uppercase tracking-wider">Start today. Cancel or export your data any time.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/auth/signup"
              className="border-2 border-black bg-[var(--color-accent)] text-white px-8 py-3.5 font-bold uppercase tracking-wider text-xs hover:bg-black transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Start for $10 / month
            </Link>
            <a
              href="https://github.com/kaya-suites/kaya-suites/releases"
              target="_blank"
              rel="noreferrer"
              className="border-2 border-black bg-[var(--color-surface)] text-black px-8 py-3.5 font-bold uppercase tracking-wider text-xs hover:bg-[var(--color-muted-bg)] transition-all"
              style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
            >
              Download OSS binary ↗
            </a>
          </div>
        </div>
      </main>

      <footer className="border-t-2 border-black py-10 mt-10">
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

function FeatureRow({ label, value, note, faded }: { label: string; value: string; note?: boolean; faded?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b-2 border-black last:border-0">
      <span className={faded ? "text-[var(--color-muted)]" : "text-black"}>{label}</span>
      <span className={`font-bold tabular-nums ${faded ? "text-[var(--color-muted)]" : "text-black"} ${note ? "text-[var(--color-muted)] font-normal" : ""}`}>
        {value}
      </span>
    </div>
  );
}
