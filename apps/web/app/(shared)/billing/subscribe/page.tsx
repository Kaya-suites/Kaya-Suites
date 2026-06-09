"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const PADDLE_CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
const PADDLE_PRICE_ID = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID ?? "";

declare global {
  interface Window {
    Paddle?: {
      Setup(opts: { token: string; eventCallback?: (event: unknown) => void }): void;
      Checkout: {
        open(opts: {
          items: Array<{ priceId: string; quantity: number }>;
          customData?: Record<string, string>;
          successUrl?: string;
        }): void;
      };
    };
  }
}

export default function SubscribePage() {
  const paddleReady = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (document.querySelector('script[src*="paddle.js"]')) return;
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      window.Paddle?.Setup({ token: PADDLE_CLIENT_TOKEN });
      paddleReady.current = true;
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.user_id && setUserId(data.user_id))
      .catch(() => null);
  }, []);

  function openCheckout() {
    if (!window.Paddle) { setError("Checkout is still loading — please try again in a moment."); return; }
    if (!userId) { setError("You must be signed in to subscribe."); return; }
    if (!PADDLE_PRICE_ID) { setError("Checkout is not configured. Contact support."); return; }
    setLoading(true);
    setError(null);
    window.Paddle.Checkout.open({
      items: [{ priceId: PADDLE_PRICE_ID, quantity: 1 }],
      customData: { user_id: userId },
      successUrl: `${window.location.origin}/billing/success`,
    });
    setTimeout(() => setLoading(false), 2000);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[var(--color-bg)]">
      <div className="w-full max-w-md">
        <h1 className="font-[var(--font-serif)] text-4xl font-semibold tracking-tight text-[var(--color-text)] mb-2">
          Kaya Suites
        </h1>
        <p className="text-[var(--font-size-base)] text-[var(--color-text-muted)] mb-10 leading-relaxed">
          AI-native knowledge base — one plan, everything included.
        </p>

        <div className="border border-[var(--color-border)] bg-[var(--color-surface)] rounded-[var(--radius-lg)] p-6 mb-8">
          <div className="flex items-baseline gap-1 mb-5">
            <span className="font-[var(--font-serif)] text-5xl font-semibold tracking-tight text-[var(--color-text)]">
              $10
            </span>
            <span className="text-[var(--color-text-muted)] text-[var(--font-size-base)]">
              / month
            </span>
          </div>
          <ul className="space-y-2.5 text-[var(--font-size-sm)] text-[var(--color-text)]">
            {[
              "Unlimited documents",
              "AI-assisted editing & search",
              "Semantic search across your knowledge base",
              "Data export at any time",
              "30-day money-back guarantee",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-[var(--color-text)]" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div
            className="border border-[var(--color-danger)] bg-[var(--color-bg-subtle)] px-4 py-3 text-[var(--font-size-sm)] text-[var(--color-danger)] mb-4 rounded-[var(--radius-md)]"
            role="alert"
          >
            {error}
          </div>
        )}

        <Button size="lg" className="w-full" onClick={openCheckout} disabled={loading}>
          {loading ? "Opening checkout…" : "Subscribe — $10/month"}
        </Button>

        <p className="mt-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-subtle)]">
          Secure checkout via Paddle. Cancel any time.
        </p>
      </div>
    </main>
  );
}
