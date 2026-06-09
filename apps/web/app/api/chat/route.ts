import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders , BACKEND_URL } from "@/lib/bff";


// Proxies the SSE stream from the Rust backend so the browser doesn't need to
// handle cross-origin streaming. Session cookie forwarding happens here too.
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as {
    message?: string;
    sessionId?: string;
    context?: { docId: string; title: string; tags: string[]; body: string } | string;
  };
  const sessionId = body.sessionId ?? "00000000-0000-0000-0000-000000000000";
  const message = body.message ?? "";
  const context = body.context;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/sessions/${sessionId}/chat`, {
      method: "POST",
      headers: forwardHeaders(request, { "Content-Type": "application/json" }),
      body: JSON.stringify({ message, context }),
    });
  } catch (err) {
    return proxyError(err, "chat");
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json({ error: text || "upstream error" }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
