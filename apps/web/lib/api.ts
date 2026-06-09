/**
 * Configure the API client with the backend base URL.
 * Import this module once at app startup (e.g. from the root layout or a
 * top-level client component) before calling any API functions.
 */
import { client } from "@kaya/api-client";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

client.setConfig({ baseUrl: API_BASE_URL });

export { client };

/**
 * `fetch` against the Rust backend with session cookies attached.
 *
 * Use for ad-hoc browser→backend calls that don't go through `@kaya/api-client`.
 * The backend is cross-site on Render (`*.onrender.com` is on the Public Suffix
 * List), so credentialed requests need both an absolute URL and
 * `credentials: "include"` — this helper centralizes both.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
  });
}
