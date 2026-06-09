import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function GET(request: NextRequest): Promise<Response> {
  try {
    const res = await fetch(`${BACKEND_URL}/sessions`, {
      headers: forwardHeaders(request),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "sessions");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json();
  try {
    const res = await fetch(`${BACKEND_URL}/sessions`, {
      method: "POST",
      headers: forwardHeaders(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "sessions");
  }
}
