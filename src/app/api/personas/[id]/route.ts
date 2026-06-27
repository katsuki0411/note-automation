import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { updateAuthorPersona, deleteAuthorPersona } from "@/lib/authorPersonas";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/personas/[id] — ペルソナ編集
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await params;
      const { name, body } = (await req.json()) as { name?: string; body?: string };
      const persona = await updateAuthorPersona(ctx.projectId, id, { name, body });
      if (!persona) {
        return Response.json({ error: "ペルソナが見つかりません" }, { status: 404 });
      }
      return Response.json({ persona });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}

// DELETE /api/personas/[id] — ペルソナ削除
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await params;
      await deleteAuthorPersona(ctx.projectId, id);
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
