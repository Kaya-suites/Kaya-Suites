import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function GET(request: NextRequest): Promise<Response> {
  try {
    const res = await fetch(`${BACKEND_URL}/sessions/preferences/folder-sidebar`, {
      headers: forwardHeaders(request),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "preferences/folder-sidebar");
  }
}

export async function PUT(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const res = await fetch(`${BACKEND_URL}/sessions/preferences/folder-sidebar`, {
      method: "PUT",
      headers: forwardHeaders(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 204) return new Response(null, { status: 204 });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "preferences/folder-sidebar");
  }
}
