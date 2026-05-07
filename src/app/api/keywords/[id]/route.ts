import { NextRequest } from "next/server";
import { deleteKeyword, updateKeyword } from "@/lib/keywords";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const patch = await req.json();
  const updated = await updateKeyword(id, patch);
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ keyword: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deleteKeyword(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
