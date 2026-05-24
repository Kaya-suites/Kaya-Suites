import type { NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function GET(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const res = await fetch(`${API_URL}/sessions/preferences/folder-sidebar`, {
      headers: { ...(cookie && { cookie }) },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ expandedFolderIds: [] }, { status: 200 });
  }
}

export async function PUT(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  try {
    const body = await request.json();
    const res = await fetch(`${API_URL}/sessions/preferences/folder-sidebar`, {
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
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
