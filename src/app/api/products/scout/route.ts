import { NextRequest } from "next/server";
import type { JSONValue } from "postgres";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import { expandKeywords } from "@/lib/keywordExpander";
import { analyzeKeywords, type CompetitionResult } from "@/lib/competitionAnalyzer";
import { loadDestinations } from "@/lib/destinations";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/products/scout
// body: { subject: string }
// → 関連KWを生成 → 各KWの DataForSEO 競合判定 (固定ドメイン分類のみ)
// → 各 destination の platform が上位N件にすでに存在するか判定
// → opportunityScore 降順で返す
//
// 2026-06-06: Gemini 五軸評価を撤去。今後、客観 API データのみで決定論的に
//   スコアリングする方針 (Step 0 = 評価軸なし状態)。
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { subject } = (await req.json().catch(() => ({}))) as {
        subject?: string;
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

      // 現プロジェクトの enabled な destination 一覧 (UI でバッジ表示に使う)
      const destinations = (await loadDestinations(ctx.projectId)).filter((d) => d.enabled);

      // Step 1: 関連KW生成 (intent付き) + ジャンル推定
      const { keywords: expanded, category } = await expandKeywords(subject);

      // Step 2: 各KWの競合判定 (DataForSEO 上位10件 → 固定ドメイン分類)
      const competitions = await analyzeKeywords(
        expanded.map((e) => ({ kw: e.kw, intent: e.intent })),
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
          platformOccupancy: {},
        };
        // 各 destination ごとに「その platform が上位30件に既に存在するか」+「プロンプト設定済か」を判定
        const destinationStatus = destinations.map((d) => {
          const platform = d.platform as Platform;
          const hits = c.platformOccupancy[platform] ?? 0;
          // prompt_config に何か文字列値が入っていれば設定済とみなす
          const pc = d.prompt_config as Record<string, unknown> | null | undefined;
          const promptReady = !!pc && Object.values(pc).some(
            (v) => typeof v === "string" && v.trim().length > 0,
          );
          return {
            destinationId: d.id,
            platform,
            label: d.label,
            platformLabel: PLATFORM_LABELS[platform] ?? platform,
            occupied: hits > 0, // true = 既に競合あり / false = 未投稿の隙間あり
            hits, // 上位30件中の該当 platform の記事数
            promptReady, // true = 記事生成可 / false = プロンプト未設定で生成不可
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
        };
      });

      // 優先ソート: opportunityScore 降順
      merged.sort((a, b) => b.opportunityScore - a.opportunityScore);

      // 履歴に保存 (失敗しても結果返却は止めない)
      let historyId: string | undefined;
      try {
        const rows = await sql<{ id: string }[]>`
          insert into product_scout_history (project_id, user_id, subject, category, candidate_count, candidates)
          values (
            ${ctx.projectId},
            ${ctx.userId},
            ${subject},
            ${category},
            ${merged.length},
            ${sql.json(merged as unknown as JSONValue)}
          )
          returning id
        `;
        historyId = rows[0]?.id;
      } catch (e) {
        console.warn("[scout] history insert failed:", e);
      }

      return Response.json({
        subject,
        category,
        candidateCount: merged.length,
        candidates: merged,
        historyId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
