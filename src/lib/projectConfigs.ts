import "server-only";
import type { JSONValue } from "postgres";
import { sql } from "./db";

// =========================================================
// プロジェクト単位の設定 (拡張プラン B')
// migration 0016 で追加された scout_config の TS 型 + アクセサ。
// article_gen_config カラム自体は DB に残っているが、フォールバックを
// 廃止 (2026-06-10) したため未使用。記事生成プロンプトは destination 単位で設定する。
// =========================================================

export type ScoutConfig = {
  // 件数
  kwCandidateCount?: number;     // Gemini #1 生成数 (default 1000、漏れなくスカウト)
  maxFinalCount?: number;         // 最終判定に回すKW数 (default 10)
  // 閾値 (Stage 3 で Gemini #2 に渡す)
  minSv?: number;                 // SV >= この値 を通過 (default 100)
  minCpc?: number;                // CPC >= この値 USD (default 0.2)
  // 除外KW
  excludeKws?: string[];
  // Gemini プロンプト3段 (未設定なら scoutPipeline 側のデフォルトを使用)
  promptKwGen?: string;           // Stage 1: KW候補生成
  promptStage3?: string;          // Stage 3: 数値+重複/不適切で 1次絞り込み
  promptFinal?: string;           // Stage 5: SERP込みの最終判定
};

// ---------- ScoutConfig ----------

export async function loadScoutConfig(projectId: string): Promise<ScoutConfig> {
  const rows = await sql<{ scout_config: ScoutConfig | null }[]>`
    select scout_config from projects where id = ${projectId} limit 1
  `;
  return rows[0]?.scout_config ?? {};
}

export async function saveScoutConfig(
  projectId: string,
  config: ScoutConfig,
): Promise<void> {
  await sql`
    update projects
       set scout_config = ${sql.json(config as unknown as JSONValue)}
     where id = ${projectId}
  `;
}

