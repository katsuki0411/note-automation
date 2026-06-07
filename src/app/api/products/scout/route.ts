import { NextRequest } from "next/server";
import type { JSONValue } from "postgres";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import { runScoutPipeline } from "@/lib/scoutPipeline";
import { detectPlatformOccupancy } from "@/lib/platformDomain";
import { loadDestinations } from "@/lib/destinations";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/products/scout
// body: { subject: string, config?: ScoutPipelineConfig }
// → 8段パイプライン (Gemini×4 + DFS×4) を実行して採用優先順位付きで返す
//
// 2026-06-07: 旧 analyzeKeywords 経由から scoutPipeline 8段パイプラインに置換。
//   評価の客観化・確からしさ向上が目的 (拡張プラン B')。
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { subject, config } = (await req.json().catch(() => ({}))) as {
        subject?: string;
        // ScoutPipelineConfig はサーバ側で安全に使えるサブセットだけ受け付ける
        // (Gemini プロンプト関数は P5 で別途設定画面から差替)
        config?: {
          kwCandidateCount?: number;
          kdMaxStage3?: number;
          minSvStage5?: number;
          minCpcStage5?: number;
          maxFinalCount?: number;
          excludeKws?: string[];
        };
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

      // 現プロジェクトの enabled な destination 一覧 (destinationStatus 用)
      const destinations = (await loadDestinations(ctx.projectId)).filter((d) => d.enabled);

      // メイン: 8段パイプライン
      const result = await runScoutPipeline(subject, config ?? {});

      // 各候補に destinationStatus を付与
      // (occupied 情報は参考表示として残す。同ドメイン排除スキップは2026-06-07撤廃済)
      const candidatesWithDest = result.candidates.map((c) => {
        const platformOccupancy = detectPlatformOccupancy(c.serpTopUrls);
        const destinationStatus = destinations.map((d) => {
          const platform = d.platform as Platform;
          const hits = platformOccupancy[platform] ?? 0;
          const pc = d.prompt_config as Record<string, unknown> | null | undefined;
          const promptReady =
            !!pc &&
            Object.values(pc).some((v) => typeof v === "string" && v.trim().length > 0);
          return {
            destinationId: d.id,
            platform,
            label: d.label,
            platformLabel: PLATFORM_LABELS[platform] ?? platform,
            occupied: hits > 0,
            hits,
            promptReady,
          };
        });
        return {
          ...c,
          platformOccupancy,
          destinationStatus,
        };
      });

      // 履歴に保存 (失敗しても結果返却は止めない)
      let historyId: string | undefined;
      try {
        const rows = await sql<{ id: string }[]>`
          insert into product_scout_history (project_id, user_id, subject, category, candidate_count, candidates)
          values (
            ${ctx.projectId},
            ${ctx.userId},
            ${subject},
            ${result.category},
            ${candidatesWithDest.length},
            ${sql.json(candidatesWithDest as unknown as JSONValue)}
          )
          returning id
        `;
        historyId = rows[0]?.id;
      } catch (e) {
        console.warn("[scout] history insert failed:", e);
      }

      return Response.json({
        subject,
        category: result.category,
        stats: result.stats,
        candidateCount: candidatesWithDest.length,
        candidates: candidatesWithDest,
        historyId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
