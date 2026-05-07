import { NextRequest } from "next/server";
import { deletePlatform, updatePlatform } from "@/lib/platforms";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const patch = await req.json();
  const updated = await updatePlatform(id, patch);
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ platform: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deletePlatform(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
