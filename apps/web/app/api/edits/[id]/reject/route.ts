import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const res = await fetch(`${BACKEND_URL}/edits/${id}/reject`, {
      method: "POST",
      headers: forwardHeaders(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "edits/[id]/reject");
  }
}
