import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function GET(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/sessions`, {
      headers: { ...(cookie && { cookie }) },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return proxyError(err, "sessions");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  const body = await request.json();
  try {
    const res = await fetch(`${API_URL}/sessions`, {
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
    return proxyError(err, "sessions");
  }
}
