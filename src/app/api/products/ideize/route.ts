import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { appendIdeas, loadFeed } from "@/lib/feed";
import type { FeedIdea } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/products/ideize
// body: { kw, intent, reason, seoDifficulty, opportunityScore, rationale }
// → 1つの商品スカウト候補を ideas (フィード) に1件追加
// 既存の記事生成フロー (article generate) で使えるようにする
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as {
        kw?: string;
        intent?: string;
        reason?: string;
        seoDifficulty?: string;
        opportunityScore?: number;
        rationale?: string;
        subject?: string; // スカウト元のキーワード/商品名
      };
      if (!body.kw?.trim()) {
        return Response.json({ error: "kw が必要です" }, { status: 400 });
      }

      const newIdea: Omit<FeedIdea, "id" | "createdAt"> = {
        source: "gemini",
        themeId: "custom",
        customLabel: body.subject ? `🛒 ${body.subject}` : "🛒 商品スカウト",
        sourceMode: "free",
        title: body.kw,
        hook: body.reason ?? "",
        angle: `機会スコア ${body.opportunityScore ?? "?"} (${body.seoDifficulty ?? "medium"}): ${body.rationale ?? ""}`,
        priorityScore: body.opportunityScore ?? 50,
      };

      const result = await appendIdeas(ctx.projectId, ctx.userId, [newIdea]);
      let saved: FeedIdea | null = result.addedIdeas[0] ?? null;
      let reused = false;

      // 同じ KW が既にネタ化済みで dedupe で skip された場合、既存 idea を取得して返す
      // (ユーザーが「同じ KW で再度記事生成したい」ケースに対応)
      if (!saved && result.skipped > 0) {
        const feed = await loadFeed(ctx.projectId);
        saved = feed.ideas.find((i) => i.title === body.kw) ?? null;
        reused = !!saved;
      }

      return Response.json({
        ok: true,
        idea: saved,
        added: result.added,
        skipped: result.skipped,
        reused,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
