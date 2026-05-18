import { NextRequest } from "next/server";
import { loadArticles } from "@/lib/storage";
import { getDestination, saveArticlePosting } from "@/lib/destinations";
import { postToDestination } from "@/lib/posters";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  articleId: string;
  destinationIds: string[];
  draft?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { articleId, destinationIds, draft = false } =
      (await req.json()) as Body;
    if (!articleId || !Array.isArray(destinationIds) || destinationIds.length === 0) {
      return Response.json(
        { error: "articleId と destinationIds が必要です" },
        { status: 400 },
      );
    }
    const articles = await loadArticles();
    const article = articles.find((a) => a.id === articleId);
    if (!article) {
      return Response.json({ error: "記事が見つかりません" }, { status: 404 });
    }

    // 各 destination に並列投稿
    const results = await Promise.all(
      destinationIds.map(async (destId) => {
        const dest = await getDestination(destId);
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
          tags: [],            // タグはプラットフォーム別に整理予定
          draft,
          imageUrl: article.imagePath,
        });
        // 投稿履歴を記録
        await saveArticlePosting({
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

    // 1件でも成功していれば articles.posted_at を更新（既存の投稿レコード機能との互換性）
    if (results.some((r) => r.ok)) {
      await sql`
        update articles set posted_at = now()
        where id = ${articleId} and posted_at is null
      `;
    }

    return Response.json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
