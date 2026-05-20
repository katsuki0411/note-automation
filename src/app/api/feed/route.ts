import { loadFeed, dismissIdea } from "@/lib/feed";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const state = await loadFeed(ctx.projectId);
    return Response.json(state);
  });
}

export async function DELETE(req: Request) {
  return withProjectContext(async (ctx) => {
    const { id } = await req.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    await dismissIdea(ctx.projectId, id);
    return Response.json({ ok: true });
  });
}
