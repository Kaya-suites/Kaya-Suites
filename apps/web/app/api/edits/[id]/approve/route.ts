import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const cookie = request.headers.get("cookie") ?? "";
  const body = await request.json();
  try {
    const res = await fetch(`${API_URL}/edits/${id}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { cookie }),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return proxyError(err, "edits/[id]/approve");
  }
}
