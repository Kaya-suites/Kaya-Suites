import type { NextRequest } from "next/server";
import { proxyError, forwardHeaders , BACKEND_URL } from "@/lib/bff";


// Proxy the PDF download so the browser gets it as an attachment regardless
// of CORS configuration on the Rust backend.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/documents/${id}/export.pdf`, {
      headers: forwardHeaders(req),
    });
    if (!res.ok) {
      return Response.json({ error: "not found" }, { status: res.status });
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? `attachment; filename="${id}.pdf"`;
    return new Response(blob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
      },
    });
  } catch (err) {
    return proxyError(err, "documents/[id]/export");
  }
}
