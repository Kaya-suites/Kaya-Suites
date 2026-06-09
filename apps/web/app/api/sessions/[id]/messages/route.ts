import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/sessions/${id}/messages`, {
      headers: forwardHeaders(req),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "sessions/[id]/messages");
  }
}
