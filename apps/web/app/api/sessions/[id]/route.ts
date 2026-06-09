import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const cookie = request.headers.get("cookie") ?? "";
  const body = await request.json();
  try {
    const res = await fetch(`${API_URL}/sessions/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { cookie }),
      },
      body: JSON.stringify(body),
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    return proxyError(err, "sessions/[id]");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/sessions/${id}`, {
      method: "DELETE",
      headers: { ...(cookie && { cookie }) },
    });
    return new Response(null, { status: res.status });
  } catch (err) {
    return proxyError(err, "sessions/[id]");
  }
}
