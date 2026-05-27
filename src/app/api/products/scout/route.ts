import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { expandKeywords } from "@/lib/keywordExpander";
import { analyzeKeywords, type CompetitionResult } from "@/lib/competitionAnalyzer";
import { appendIdeas } from "@/lib/feed";
import type { FeedIdea, ThemeId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/products/scout
// body: { subject: string } — 商品名 or キーワード or カテゴリ
// → 関連KWを生成 → 各KWの Brave 競合判定 → opportunityScore 降順で返す
export async function POST(req: NextRequest) {
  return withProjectContext(async () => {
    try {
      const { subject, ideize = false } = (await req.json().catch(() => ({}))) as {
        subject?: string;
        ideize?: boolean; // true なら結果上位を ideas にも保存
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

      // Step 1: 関連KW生成
      const expanded = await expandKeywords(subject);

      // Step 2: 各KWの競合判定 (Brave検索)
      const competitions = await analyzeKeywords(
        expanded.map((e) => e.kw),
        { concurrency: 3 },
      );

      // expanded と competitions をマージ
      const merged = expanded.map((e, i) => {
        const c: CompetitionResult = competitions[i] ?? {
          kw: e.kw,
          totalScanned: 0,
          buckets: { big_ec: 0, big_media: 0, individual_blog: 0, other: 0 },
          seoDifficulty: "medium",
          opportunityScore: 50,
          rationale: "分析未実施",
          topUrls: [],
        };
        return {
          kw: c.kw,
          intent: e.intent,
          reason: e.reason,
          seoDifficulty: c.seoDifficulty,
          opportunityScore: c.opportunityScore,
          rationale: c.rationale,
          buckets: c.buckets,
          totalScanned: c.totalScanned,
          topUrls: c.topUrls,
        };
      });

      // 機会スコア降順でソート
      merged.sort((a, b) => b.opportunityScore - a.opportunityScore);

      return Response.json({
        subject,
        candidateCount: merged.length,
        candidates: merged,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
