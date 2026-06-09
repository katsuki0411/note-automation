import "server-only";
import type { JSONValue } from "postgres";
import { sql } from "./db";

// =========================================================
// プロジェクト単位の設定 (拡張プラン B' + 3段プロンプト記事生成)
// migration 0016 で追加された scout_config / article_gen_config の TS 型 + アクセサ
// =========================================================

export type ScoutConfig = {
  // 件数
  kwCandidateCount?: number;     // Gemini #1 生成数 (default 100)
  maxFinalCount?: number;         // 最終判定に回すKW数 (default 10)
  // 閾値
  kdMaxStage3?: number;           // KD <= この値 を通過 (default 30)
  minSvStage5?: number;           // SV >= この値 を通過 (default 100)
  minCpcStage5?: number;          // CPC >= この値 USD (default 0.2)
  // 除外KW
  excludeKws?: string[];
  // Gemini プロンプト4段 (未設定なら scoutPipeline 側のデフォルトを使用)
  promptKwGen?: string;           // Stage 1: KW候補生成 — 直接 keywordExpander にも渡せる将来拡張
  promptStage3?: string;          // Stage 3: KD閾値後の1次絞り込み
  promptStage5?: string;          // Stage 5: 数値後の2次絞り込み
  promptFinal?: string;           // Stage 7: 最終判定
};

export type ArticleGenConfig = {
  // 3段プロンプトチェーン (各段の入力テキスト)
  // 1段目: 通常のプロンプト → 1次出力
  // 2段目: 1次出力 + 2段目プロンプト → 2次出力
  // 3段目: 2次出力 + 3段目プロンプト → 最終投稿内容
  prompts?: [string, string, string];
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

// ---------- ArticleGenConfig ----------

export async function loadArticleGenConfig(projectId: string): Promise<ArticleGenConfig> {
  const rows = await sql<{ article_gen_config: ArticleGenConfig | null }[]>`
    select article_gen_config from projects where id = ${projectId} limit 1
  `;
  return rows[0]?.article_gen_config ?? {};
}

export async function saveArticleGenConfig(
  projectId: string,
  config: ArticleGenConfig,
): Promise<void> {
  await sql`
    update projects
       set article_gen_config = ${sql.json(config as unknown as JSONValue)}
     where id = ${projectId}
  `;
}
