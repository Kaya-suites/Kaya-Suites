import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders, passthrough , BACKEND_URL } from "@/lib/bff";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/documents/${id}`, {
      headers: forwardHeaders(req),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "documents/[id]");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/documents/${id}`, {
      method: "PUT",
      headers: forwardHeaders(req, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "documents/[id]");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/documents/${id}`, {
      method: "DELETE",
      headers: forwardHeaders(req),
    });
    if (res.status === 204) return new Response(null, { status: 204 });
    return passthrough(res);
  } catch (err) {
    return proxyError(err, "documents/[id]");
  }
}
