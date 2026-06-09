import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/documents/${id}/order`, {
      method: "PUT",
      headers: forwardHeaders(req, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 204) return new Response(null, { status: 204 });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "documents/[id]/order");
  }
}
