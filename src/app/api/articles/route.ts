import { loadArticles } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const articles = await loadArticles();
  return Response.json({ articles });
}
