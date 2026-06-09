// Shared helper for app/api/**/route.ts (the Next.js BFF layer).
//
// Centralizes the failure path so an unreachable backend stops looking like
// "no data" (e.g. `/api/sessions` previously returned `[]` with 200 on a
// connection failure, hiding outages from the UI).

import type { NextRequest } from "next/server";

/**
 * Backend URL for Node-side fetches from BFF routes.
 *
 * Prefers `BACKEND_INTERNAL_URL` (server-only, e.g. `http://127.0.0.1:3001`)
 * over `NEXT_PUBLIC_API_URL`. The split exists because `NEXT_PUBLIC_API_URL`
 * needs to be on the same host as the Next.js dev server so browser cookies
 * stay same-site, while the BFF wants `127.0.0.1` to dodge Node undici's
 * IPv6-first resolution.
 */
export const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:3001";

interface FetchErrorLike {
  cause?: { code?: string };
  message?: string;
}

/**
 * Build headers for a backend fetch. Forwards the cookie, plus the real
 * browser `Origin`/`Referer` as `X-Forwarded-Origin`/`X-Forwarded-Referer`
 * so the backend's CSRF guard can see them — Node's undici fetch does not
 * propagate `Origin` itself.
 */
export function forwardHeaders(
  request: NextRequest,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const origin = request.headers.get("origin");
  if (origin) headers["x-forwarded-origin"] = origin;
  const referer = request.headers.get("referer");
  if (referer) headers["x-forwarded-referer"] = referer;
  return headers;
}

/**
 * Transparently pass through a backend response — status, content-type, and
 * body bytes. Avoids `res.json()` crashing on empty 4xx bodies (which is how
 * axum's default 401 responses look) and keeps the BFF from rewriting status
 * codes the SPA needs to see (e.g. 401 → redirect to sign-in).
 */
export async function passthrough(res: Response): Promise<Response> {
  const text = await res.text();
  if (!text) {
    return new Response(null, { status: res.status });
  }
  const contentType = res.headers.get("content-type") ?? "application/json";
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": contentType },
  });
}

/**
 * Log the underlying fetch failure with structured fields, and return a 502
 * response. In dev the error code/message is included in the body so the
 * common `ECONNREFUSED` / `ENOTFOUND` case is obvious; in production the
 * body stays opaque so we don't leak internal hostnames.
 */
export function proxyError(err: unknown, route: string): Response {
  const e = err as FetchErrorLike;
  const code = e?.cause?.code;
  const message = e?.message;
  console.error(
    `[bff] backend fetch failed for ${route}: code=${code ?? "?"} message=${message ?? "?"}`,
  );
  const body: Record<string, string> = { error: "backend_unreachable" };
  if (process.env.NODE_ENV !== "production") {
    if (code) body.code = code;
    if (message) body.detail = message;
    body.route = route;
  }
  return Response.json(body, { status: 502 });
}
