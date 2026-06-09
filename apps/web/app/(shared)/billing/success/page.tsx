import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BillingSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[var(--color-bg)]">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-[var(--radius-pill)] bg-[var(--color-bg-subtle)] text-[var(--color-success)] mb-8">
          <Check size={22} strokeWidth={2} />
        </div>
        <h1 className="font-[var(--font-serif)] text-4xl font-semibold tracking-tight text-[var(--color-text)] mb-4">
          Welcome to Kaya Suites
        </h1>
        <p className="text-[var(--font-size-base)] text-[var(--color-text-muted)] leading-relaxed mb-10">
          Your subscription is active. We&apos;ve sent a confirmation email.
          You&apos;re covered by our 30-day money-back guarantee.
        </p>

        <Link href="/chat">
          <Button size="lg">Start using Kaya</Button>
        </Link>

        <p className="mt-10 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
          Need help?{" "}
          <a
            href="mailto:support@kaya.io"
            className="underline underline-offset-2 font-medium text-[var(--color-text)] hover:text-[var(--color-text-muted)]"
          >
            Contact support
          </a>
        </p>
      </div>
    </main>
  );
}
