import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Kaya Suites",
  description: "How Kaya Suites collects, uses, and protects your data.",
};

const LAST_UPDATED = "May 13, 2026";

const navLinkClass = "text-xs font-bold uppercase tracking-wider text-black hover:text-[var(--color-accent)] transition-colors font-mono";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen font-mono" style={{ background: "var(--color-background)", color: "var(--color-foreground)" }}>
      <nav className="border-b-2 border-black px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="font-bold text-sm tracking-wider uppercase hover:text-[var(--color-accent)] transition-colors">Kaya Suites</Link>
        <Link
          href="/auth/signin"
          className="border-2 border-black bg-black text-white px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] transition-all"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          Sign in
        </Link>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tight">Privacy Policy</h1>
        <p className="text-xs text-[var(--color-muted)] mb-12 uppercase tracking-wider">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8">
          {[
            {
              title: "1. What we collect",
              content: (
                <>
                  <p>When you create an account we collect your email address. When you use the cloud service we collect:</p>
                  <ul>
                    <li>Document content you create or import.</li>
                    <li>Usage events (operation type, token counts, model used, timestamp).</li>
                    <li>Session tokens stored in an HTTP-only cookie.</li>
                    <li>Subscription and billing information processed by Paddle.</li>
                  </ul>
                </>
              ),
            },
            {
              title: "2. How we use your data",
              content: (
                <>
                  <p>To provide the Kaya Suites service, calculate usage limits, send transactional emails, and process payments. We do not use your data for advertising and we do not sell it to third parties.</p>
                </>
              ),
            },
            {
              title: "3. AI and your document content",
              content: (
                <p>Edit proposals are processed by Anthropic and OpenAI APIs in <strong>zero-data-retention mode</strong>: your content is not logged and is not used to train their models.</p>
              ),
            },
            {
              title: "4. Data storage and security",
              content: <p>Cloud data is stored in a managed Postgres instance (Neon). Connections are encrypted with TLS. Session cookies are HTTP-only, Secure, and SameSite=Lax.</p>,
            },
            {
              title: "5. Data retention and deletion",
              content: <p>You may export all data from your dashboard. Account deletion removes all data within 30 days. Email <a href="mailto:privacy@kaya-suites.com" className="underline font-bold">privacy@kaya-suites.com</a> to request deletion.</p>,
            },
            {
              title: "6. Cookies",
              content: <p>We use a single session cookie (<code className="bg-[var(--color-muted-bg)] border border-black px-1">kaya_session</code>) for authentication. No analytics cookies. No third-party tracking.</p>,
            },
            {
              title: "7. Contact",
              content: <p>Questions? <a href="mailto:privacy@kaya-suites.com" className="underline font-bold hover:text-[var(--color-accent)]">privacy@kaya-suites.com</a></p>,
            },
          ].map(({ title, content }) => (
            <section key={title} className="border-2 border-black p-6" style={{ borderRadius: "var(--border-radius)", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-xs font-black uppercase tracking-wider mb-3 text-[var(--color-accent)]">{title}</h2>
              <div className="text-xs text-black leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">{content}</div>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t-2 border-black py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--color-muted)] font-mono uppercase tracking-wider">
          <span>© {new Date().getFullYear()} Kaya Suites</span>
          <div className="flex gap-6">
            <Link href="/pricing" className={navLinkClass}>Pricing</Link>
            <Link href="/privacy" className={navLinkClass}>Privacy</Link>
            <Link href="/terms" className={navLinkClass}>Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
