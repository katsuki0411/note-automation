import { loadFeed, dismissIdea } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await loadFeed();
  return Response.json(state);
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await dismissIdea(id);
  return Response.json({ ok: true });
}
