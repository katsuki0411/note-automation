import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { expandKeywords } from "@/lib/keywordExpander";
import { analyzeKeywords, type CompetitionResult } from "@/lib/competitionAnalyzer";
import { loadDestinations } from "@/lib/destinations";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/products/scout
// body: { subject: string, useAI?: boolean (default true) }
// → 関連KWを生成 → 各KWの Brave 競合判定 + Gemini 五軸評価
// → 各 destination の platform が上位30件にすでに存在するか判定
// → opportunityScore 降順で返す
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { subject, useAI = true } = (await req.json().catch(() => ({}))) as {
        subject?: string;
        useAI?: boolean;
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

      // 現プロジェクトの enabled な destination 一覧 (UI でバッジ表示に使う)
      const destinations = (await loadDestinations(ctx.projectId)).filter((d) => d.enabled);

      // Step 1: 関連KW生成 (intent付き)
      const expanded = await expandKeywords(subject);

      // Step 2: 各KWの競合判定 (Brave検索 + 任意で Gemini 五軸評価)
      const competitions = await analyzeKeywords(
        expanded.map((e) => ({ kw: e.kw, intent: e.intent })),
        { concurrency: 3, useAI },
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
          platformOccupancy: {},
        };
        // 各 destination ごとに「その platform が上位30件に既に存在するか」を判定
        const destinationStatus = destinations.map((d) => {
          const platform = d.platform as Platform;
          const hits = c.platformOccupancy[platform] ?? 0;
          return {
            destinationId: d.id,
            platform,
            label: d.label,
            platformLabel: PLATFORM_LABELS[platform] ?? platform,
            occupied: hits > 0, // true = 既に競合あり / false = 未投稿の隙間あり
            hits, // 上位30件中の該当 platform の記事数
          };
        });
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
          platformOccupancy: c.platformOccupancy,
          destinationStatus,
          ai: c.ai,
        };
      });

      // 優先ソート: AI overall があれば優先、なければ opportunityScore で
      merged.sort((a, b) => {
        const sa = a.ai?.overall ?? a.opportunityScore;
        const sb = b.ai?.overall ?? b.opportunityScore;
        return sb - sa;
      });

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
