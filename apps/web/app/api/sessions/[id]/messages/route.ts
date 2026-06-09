import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/sessions/${id}/messages`, {
      headers: { ...(cookie && { cookie }) },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return proxyError(err, "sessions/[id]/messages");
  }
}
