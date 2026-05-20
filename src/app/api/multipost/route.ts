import { NextRequest } from "next/server";
import { loadArticles } from "@/lib/storage";
import { getDestination, saveArticlePosting } from "@/lib/destinations";
import { postToDestination } from "@/lib/posters";
import { sql } from "@/lib/db";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  articleId: string;
  destinationIds: string[];
  draft?: boolean;
};

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { articleId, destinationIds, draft = false } =
        (await req.json()) as Body;
      if (!articleId || !Array.isArray(destinationIds) || destinationIds.length === 0) {
        return Response.json(
          { error: "articleId と destinationIds が必要です" },
          { status: 400 },
        );
      }
      const articles = await loadArticles(ctx.projectId);
      const article = articles.find((a) => a.id === articleId);
      if (!article) {
        return Response.json({ error: "記事が見つかりません" }, { status: 404 });
      }

      // 各 destination に並列投稿
      const results = await Promise.all(
        destinationIds.map(async (destId) => {
          const dest = await getDestination(ctx.projectId, destId);
          if (!dest) {
            return {
              destinationId: destId,
              ok: false,
              error: "destination が見つかりません",
            };
          }
          const result = await postToDestination(dest, {
            title: article.bestTitle,
            bodyMarkdown: article.bodyMarkdown,
            tags: [],
            draft,
            imageUrl: article.imagePath,
          });
          await saveArticlePosting(ctx.projectId, ctx.userId, {
            articleId,
            destinationId: dest.id,
            destinationLabel: dest.label,
            platform: dest.platform,
            status: result.ok ? "success" : "failed",
            externalUrl: result.url,
            error: result.error,
          });
          return {
            destinationId: destId,
            destinationLabel: dest.label,
            platform: dest.platform,
            ...result,
          };
        }),
      );

      if (results.some((r) => r.ok)) {
        await sql`
          update articles set posted_at = now()
          where id = ${articleId} and project_id = ${ctx.projectId} and posted_at is null
        `;
      }

      return Response.json({ results });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
