import { NextRequest } from "next/server";
import { markArticlePosted } from "@/lib/storage";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { articleId } = (await req.json()) as { articleId: string };
      if (!articleId) {
        return Response.json({ error: "articleIdが必要です" }, { status: 400 });
      }
      await markArticlePosted(ctx.projectId, articleId);
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
