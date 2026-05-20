import { NextRequest } from "next/server";
import { deleteTarget, updateTarget } from "@/lib/seoRank";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await routeCtx.params;
      const patch = await req.json();
      const updated = await updateTarget(ctx.projectId, id, patch);
      if (!updated) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ target: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 400 });
    }
  });
}

export async function DELETE(
  _req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    const { id } = await routeCtx.params;
    const ok = await deleteTarget(ctx.projectId, id);
    if (!ok) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ok: true });
  });
}
