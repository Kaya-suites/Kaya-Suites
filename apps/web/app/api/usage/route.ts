import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function GET(request: NextRequest): Promise<Response> {
  try {
    const res = await fetch(`${BACKEND_URL}/sessions/usage`, {
      headers: forwardHeaders(request),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "usage");
  }
}
