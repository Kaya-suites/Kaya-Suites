import type { NextRequest } from "next/server";
import { proxyError } from "@/lib/bff";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/documents/${id}/order`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { cookie }),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 204) return new Response(null, { status: 204 });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return proxyError(err, "documents/[id]/order");
  }
}
