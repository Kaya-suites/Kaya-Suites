import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Kaya Suites",
  description: "Terms governing use of the Kaya Suites cloud service.",
};

const LAST_UPDATED = "May 13, 2026";

const navLinkClass = "text-xs font-bold uppercase tracking-wider text-black hover:text-[var(--color-accent)] transition-colors font-mono";

const sections = [
  { title: "1. Acceptance", body: "By accessing or using the Kaya Suites cloud service you agree to these Terms. If you are using the Service on behalf of an organisation, you represent that you have authority to bind that organisation." },
  { title: "2. Description of the Service", body: "Kaya Suites provides an AI-assisted knowledge base: document storage, semantic search, and an AI editing loop that detects stale content and proposes edits for human review. The open-source binary is governed solely by the Apache 2.0 licence." },
  { title: "3. Accounts", body: "You must provide a valid email address. You are responsible for all activity that occurs under your account. Notify support@kaya-suites.com immediately if you suspect unauthorised access." },
  { title: "4. Acceptable use", body: "You agree not to upload content you do not have the right to share, circumvent usage limits, use the Service to generate unlawful content, reverse engineer BSL-licensed components, or resell the Service without written permission." },
  { title: "5. Your content", body: "You retain ownership of all documents and content you create. You grant us a limited licence to store and process your content solely to provide the Service. Your content is processed under zero-data-retention agreements — we do not use it to train AI models." },
  { title: "6. Subscription and billing", body: "The cloud plan is $10 USD per workspace per month, billed via Paddle. Overage invocations are charged at $0.10 each. 30-day money-back guarantee: if unsatisfied within 30 days of your first payment, email us for a full refund, no questions asked." },
  { title: "7. Cancellation", body: "You may cancel at any time from your dashboard. Access continues until the end of the current billing period. No refunds for partial periods (except under the 30-day guarantee)." },
  { title: "8. Limitation of liability", body: "To the maximum extent permitted by law, Kaya Suites shall not be liable for indirect, incidental, special, or consequential damages. Our total liability shall not exceed fees paid in the 12 months preceding the claim." },
  { title: "9. Disclaimer of warranties", body: 'THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.' },
  { title: "10. Governing law", body: "These Terms are governed by the laws of the State of California, USA, without regard to conflict of law principles." },
  { title: "11. Contact", body: "support@kaya-suites.com" },
];

export default function TermsPage() {
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
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tight">Terms of Service</h1>
        <p className="text-xs text-[var(--color-muted)] mb-12 uppercase tracking-wider">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-4">
          {sections.map(({ title, body }) => (
            <section
              key={title}
              className="border-2 border-black p-6"
              style={{ borderRadius: "var(--border-radius)", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="text-xs font-black uppercase tracking-wider mb-3 text-[var(--color-accent)]">{title}</h2>
              <p className="text-xs text-black leading-relaxed">{body}</p>
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
