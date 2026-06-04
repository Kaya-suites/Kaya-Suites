import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 font-mono" style={{ background: "var(--color-background)" }}>
      <div
        className="w-full max-w-md bg-[var(--color-surface)] border-2 border-black p-10 text-center"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="inline-flex items-center justify-center w-16 h-16 border-2 border-[var(--color-success)] bg-[#C8F0D8] text-3xl mb-6"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          ✓
        </div>
        <h1 className="text-2xl font-black text-black mb-3 uppercase tracking-tight">
          Welcome to Kaya Suites
        </h1>
        <p className="text-[var(--color-muted)] leading-relaxed mb-8 text-xs">
          Your subscription is active. We&apos;ve sent a confirmation email.
          You&apos;re covered by our 30-day money-back guarantee.
        </p>

        <Link
          href="/chat"
          className="inline-block border-2 border-black bg-[var(--color-accent)] text-white py-3 px-8 font-bold text-xs uppercase tracking-wider hover:bg-black transition-all"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          Start using Kaya →
        </Link>

        <p className="mt-8 text-xs text-[var(--color-muted)]">
          Need help?{" "}
          <a href="mailto:support@kaya.io" className="underline font-bold text-black hover:text-[var(--color-accent)]">
            Contact support
          </a>
        </p>
      </div>
    </main>
  );
}
