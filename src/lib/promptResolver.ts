import type { PostingDestinationRow } from "./posters/types";

// destination の prompt_config の構造定義。
// 3段プロンプトチェーンのみを使用する。
// DB には旧10項目 (role/authorProfile/...) の残骸が入っているレコードがあるが、
// 2026-06-10 以降はすべて無視する。記事生成は stages のみで動く。
export type DestinationPromptConfig = {
  stages?: [string, string, string];
};

/**
 * destination の prompt_config.stages から有効な3段プロンプトを取り出す。
 * いずれかの段に文字列が入っていれば返す。全段空 (or stages 自体なし) なら null。
 */
export function extractDestinationStages(
  destination: PostingDestinationRow,
): [string, string, string] | null {
  const cfg = (destination.prompt_config ?? {}) as DestinationPromptConfig;
  const stages = cfg.stages;
  if (!Array.isArray(stages) || stages.length !== 3) return null;
  const arr: [string, string, string] = [
    typeof stages[0] === "string" ? stages[0] : "",
    typeof stages[1] === "string" ? stages[1] : "",
    typeof stages[2] === "string" ? stages[2] : "",
  ];
  if (arr.every((s) => !s.trim())) return null;
  return arr;
}

/**
 * destination が「記事生成可能な状態」か判定する。
 * 3段プロンプトのいずれかに有効値があれば true。
 * UI のプロンプト有/無バッジと、記事生成 API の事前チェックでも同じ判定を使う。
 */
export function isPromptConfigConfigured(
  destination: PostingDestinationRow | { prompt_config?: unknown },
): boolean {
  return extractDestinationStages(destination as PostingDestinationRow) !== null;
}

export const PROMPT_NOT_CONFIGURED_ERROR =
  "投稿先のプロンプトが設定されていません。設定 → 投稿先 → 各サイトの「プロンプト編集」で 3段プロンプトを設定してください。";
