import { NextRequest } from "next/server";
import { deleteDestination, updateDestination } from "@/lib/destinations";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await params;
      const patch = (await req.json()) as {
        label?: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
      };
      await updateDestination(ctx.projectId, id, patch);
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await params;
      await deleteDestination(ctx.projectId, id);
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
