import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import {
  loadArticleGenConfig,
  saveArticleGenConfig,
  type ArticleGenConfig,
} from "@/lib/projectConfigs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/article-gen-config
export async function GET() {
  return withProjectContext(async (ctx) => {
    try {
      const config = await loadArticleGenConfig(ctx.projectId);
      return Response.json({ config });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "unknown" },
        { status: 500 },
      );
    }
  });
}

// PUT /api/projects/article-gen-config
// body: { prompts: [string, string, string] }
// 1段ずつのプロンプト。空文字は「その段スキップ」を意味する (フロント側でハンドル)
export async function PUT(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as ArticleGenConfig;
      const sanitized: ArticleGenConfig = {};
      if (Array.isArray(body.prompts)) {
        // 必ず長さ3に正規化 (足りない/長い分はパディング/切詰)
        const arr = [0, 1, 2].map((i) => {
          const v = body.prompts?.[i];
          return typeof v === "string" ? v.slice(0, 30_000) : "";
        }) as [string, string, string];
        sanitized.prompts = arr;
      }
      await saveArticleGenConfig(ctx.projectId, sanitized);
      return Response.json({ ok: true, config: sanitized });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "unknown" },
        { status: 500 },
      );
    }
  });
}
