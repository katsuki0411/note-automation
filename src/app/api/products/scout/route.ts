import { NextRequest } from "next/server";
import type { JSONValue } from "postgres";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import { runScoutPipeline } from "@/lib/scoutPipeline";
import { detectPlatformOccupancy } from "@/lib/platformDomain";
import { loadDestinations } from "@/lib/destinations";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";
import { loadScoutConfig } from "@/lib/projectConfigs";
import { isPromptConfigConfigured } from "@/lib/promptResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 同一 subject の過去スカウト履歴 + 記事から、Stage 1 で除外すべき KW を集める。
// (1) 重複として削除された KW (rejected_candidates の stage="stage3_duplicate")
// (2) 記事生成に使った KW (= 過去に採用された KW のうち articles.idea.title に存在するもの)
// subject 単位でスコープするので、別商品のスカウトには影響しない。
async function buildSubjectExcludeKws(projectId: string, subject: string): Promise<string[]> {
  try {
    const pastRows = await sql<
      {
        candidates: Array<{ kw?: string }> | null;
        rejected_candidates: Array<{ kw?: string; stage?: string }> | null;
      }[]
    >`
      select candidates, rejected_candidates
      from product_scout_history
      where project_id = ${projectId} and lower(subject) = lower(${subject})
    `;
    if (pastRows.length === 0) return [];

    const duplicateKws = new Set<string>();
    const adoptedKws = new Set<string>();
    for (const row of pastRows) {
      for (const r of row.rejected_candidates ?? []) {
        if (r?.stage === "stage3_duplicate" && r.kw) duplicateKws.add(r.kw);
      }
      for (const c of row.candidates ?? []) {
        if (c?.kw) adoptedKws.add(c.kw);
      }
    }

    // 記事化済み KW: 採用 KW のうち、実際に articles に存在する title (= 記事生成された KW) だけ
    const articleRows = await sql<{ title: string | null }[]>`
      select distinct idea->>'title' as title from articles where project_id = ${projectId}
    `;
    const articleTitleSet = new Set(
      articleRows.map((r) => (r.title ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const articleUsedKws = [...adoptedKws].filter((kw) =>
      articleTitleSet.has(kw.trim().toLowerCase()),
    );

    return [...duplicateKws, ...articleUsedKws];
  } catch (e) {
    // 除外リスト構築の失敗でスカウト本体を止めない
    console.warn("[scout] buildSubjectExcludeKws failed:", e);
    return [];
  }
}

// POST /api/products/scout
// body: { subject: string, config?: ScoutPipelineConfig }
// → 6段パイプライン (Gemini×3 + DFS×4) を実行して採用優先順位付きで返す
//
// 2026-06-07: 旧 analyzeKeywords 経由から scoutPipeline パイプラインに置換。
//   評価の客観化・確からしさ向上が目的 (拡張プラン B')。
// 2026-06-25: 同一subject再スカウト時、過去の重複KW+記事化KWを Stage 1 で自動除外。
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { subject, config } = (await req.json().catch(() => ({}))) as {
        subject?: string;
        // ScoutPipelineConfig のサブセットだけ受け付ける (5段パイプライン用)
        config?: {
          kwCandidateCount?: number;
          minSv?: number;
          minCpc?: number;
          maxFinalCount?: number;
          excludeKws?: string[];
        };
      };
      if (!subject?.trim()) {
        return Response.json({ error: "subject が必要です" }, { status: 400 });
      }

      // 現プロジェクトの enabled な destination 一覧 (destinationStatus 用)
      const destinations = (await loadDestinations(ctx.projectId)).filter((d) => d.enabled);

      // プロジェクト設定 (除外KW / 閾値 / Gemini プロンプト3段) を読み込んで、
      // body.config と合体 (body 優先)。
      const projectConfig = await loadScoutConfig(ctx.projectId);

      // 手動除外リスト (body > scout_config)
      const manualExclude = config?.excludeKws ?? projectConfig.excludeKws ?? [];

      // 同一 subject の過去スカウトから「重複として削除されたKW」+「記事生成に使ったKW」を
      // 集めて Stage 1 の除外に自動追加する (2026-06-25)。
      // 同じ商品を再スカウトしたときに同じKWを作り直さないため。別 subject には影響しない。
      const autoExclude = await buildSubjectExcludeKws(ctx.projectId, subject);

      // 大文字小文字を無視して重複排除 (表示は元の表記を保持)
      const excludeKws = Array.from(
        new Map(
          [...manualExclude, ...autoExclude].map((k) => [k.trim().toLowerCase(), k.trim()]),
        ).values(),
      ).filter(Boolean);
      if (autoExclude.length > 0) {
        console.log(
          `[scout] 自動除外 (同一subject="${subject}"): 重複/記事化KW ${autoExclude.length}件 → 合計除外 ${excludeKws.length}件`,
        );
      }

      const mergedConfig = {
        kwCandidateCount: config?.kwCandidateCount ?? projectConfig.kwCandidateCount,
        minSv: config?.minSv ?? projectConfig.minSv,
        minCpc: config?.minCpc ?? projectConfig.minCpc,
        maxFinalCount: config?.maxFinalCount ?? projectConfig.maxFinalCount,
        excludeKws,
        // Gemini プロンプト3段 (文字列テンプレ、空欄ならデフォルト)
        promptKwGen: projectConfig.promptKwGen,
        promptStage3: projectConfig.promptStage3,
        promptFinal: projectConfig.promptFinal,
      };

      // メイン: 8段パイプライン
      const result = await runScoutPipeline(subject, mergedConfig);

      // 各候補に destinationStatus を付与
      // (occupied 情報は参考表示として残す。同ドメイン排除スキップは2026-06-07撤廃済)
      const candidatesWithDest = result.candidates.map((c) => {
        const platformOccupancy = detectPlatformOccupancy(c.serpTopUrls);
        const destinationStatus = destinations.map((d) => {
          const platform = d.platform as Platform;
          const hits = platformOccupancy[platform] ?? 0;
          // 3段プロンプトが入っていれば promptReady = true (旧10項目残骸は無視)
          const promptReady = isPromptConfigConfigured(d);
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
          insert into product_scout_history (
            project_id, user_id, subject, category,
            candidate_count, candidates,
            rejected_candidates, pipeline_stats
          )
          values (
            ${ctx.projectId},
            ${ctx.userId},
            ${subject},
            ${result.category},
            ${candidatesWithDest.length},
            ${sql.json(candidatesWithDest as unknown as JSONValue)},
            ${sql.json((result.rejectedCandidates ?? []) as unknown as JSONValue)},
            ${sql.json((result.stats ?? null) as unknown as JSONValue)}
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
        // Stage 1 で生成されたが Stage 3/5 で落選した KW (落選理由付き)
        rejectedCandidates: result.rejectedCandidates,
        historyId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
