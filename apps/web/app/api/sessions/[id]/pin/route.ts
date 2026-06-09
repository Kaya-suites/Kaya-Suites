import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders , BACKEND_URL } from "@/lib/bff";


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = await request.json();
  try {
    const res = await fetch(`${BACKEND_URL}/sessions/${id}/pin`, {
      method: "POST",
      headers: forwardHeaders(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    return proxyError(err, "sessions/[id]/pin");
  }
}
