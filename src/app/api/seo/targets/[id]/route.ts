import { NextRequest } from "next/server";
import { deleteTarget, updateTarget } from "@/lib/seoRank";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const patch = await req.json();
    const updated = await updateTarget(id, patch);
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ target: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deleteTarget(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
