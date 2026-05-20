import { loadArticles } from "@/lib/storage";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const articles = await loadArticles(ctx.projectId);
    return Response.json({ articles });
  });
}
