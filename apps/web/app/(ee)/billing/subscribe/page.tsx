"use client";

import { useEffect, useRef, useState } from "react";

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
    <main className="min-h-screen flex items-center justify-center px-4 font-mono" style={{ background: "var(--color-background)" }}>
      <div
        className="w-full max-w-md bg-[var(--color-surface)] border-2 border-black p-10"
        style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-2xl font-black text-black mb-2 uppercase tracking-tight">
          Kaya Suites
        </h1>
        <p className="text-[var(--color-muted)] mb-8 leading-relaxed text-xs">
          AI-native knowledge base — one plan, everything included.
        </p>

        <div
          className="border-2 border-black bg-[var(--color-muted-bg)] p-6 mb-8"
          style={{ borderRadius: "var(--border-radius)" }}
        >
          <div className="flex items-baseline gap-1 mb-4">
            <span className="text-4xl font-black text-black">$10</span>
            <span className="text-[var(--color-muted)] text-sm">/month</span>
          </div>
          <ul className="space-y-2 text-xs text-black">
            {[
              "Unlimited documents",
              "AI-assisted editing & search",
              "Semantic search across your knowledge base",
              "Data export at any time",
              "30-day money-back guarantee",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-[var(--color-accent)] font-bold">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div
            className="border-2 border-[var(--color-danger)] bg-[#FFD6CC] px-4 py-3 text-xs text-[var(--color-danger)] font-bold mb-4"
            style={{ borderRadius: "var(--border-radius)" }}
          >
            {error}
          </div>
        )}

        <button
          onClick={openCheckout}
          disabled={loading}
          className="w-full border-2 border-black bg-[var(--color-accent)] text-white py-3 px-6 font-bold text-xs uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderRadius: "var(--border-radius)", boxShadow: "var(--shadow-button)" }}
        >
          {loading ? "Opening checkout…" : "Subscribe — $10/month"}
        </button>

        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          Secure checkout via Paddle. Cancel any time.
        </p>
      </div>
    </main>
  );
}
