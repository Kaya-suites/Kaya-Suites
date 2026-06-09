import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function GET(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/sessions/usage`, {
      headers: { ...(cookie && { cookie }) },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return proxyError(err, "usage");
  }
}
