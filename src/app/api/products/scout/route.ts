import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { expandKeywords } from "@/lib/keywordExpander";
import { analyzeKeywords, type CompetitionResult } from "@/lib/competitionAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/products/scout
// body: { subject: string, useAI?: boolean (default true) }
// → 関連KWを生成 → 各KWの Brave 競合判定 + Gemini 五軸評価 → opportunityScore 降順で返す
export async function POST(req: NextRequest) {
  return withProjectContext(async () => {
    try {
      const { subject, useAI = true } = (await req.json().catch(() => ({}))) as {
        subject?: string;
        useAI?: boolean;
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

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
          ai: c.ai, // Gemini 五軸評価 (取得失敗時は undefined)
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
