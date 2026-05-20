import { NextRequest } from "next/server";
import { deleteKeyword, updateKeyword } from "@/lib/keywords";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    const { id } = await routeCtx.params;
    const patch = await req.json();
    const updated = await updateKeyword(ctx.projectId, id, patch);
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ keyword: updated });
  });
}

export async function DELETE(
  _req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    const { id } = await routeCtx.params;
    const ok = await deleteKeyword(ctx.projectId, id);
    if (!ok) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ok: true });
  });
}
