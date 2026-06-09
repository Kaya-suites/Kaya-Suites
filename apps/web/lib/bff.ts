// Shared helper for app/api/**/route.ts (the Next.js BFF layer).
//
// Centralizes the failure path so an unreachable backend stops looking like
// "no data" (e.g. `/api/sessions` previously returned `[]` with 200 on a
// connection failure, hiding outages from the UI).

interface FetchErrorLike {
  cause?: { code?: string };
  message?: string;
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
