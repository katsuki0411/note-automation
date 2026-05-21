import { ARTICLE_SYSTEM } from "./prompts";
import type { PostingDestinationRow } from "./posters/types";
import type { ProjectPersonaConfig } from "./projects";

// destination の prompt_config の構造定義 (UI のフォーム項目と1対1)。
// 各項目はオプショナル。空オブジェクト {} の場合は fallback ロジックに従う。
export type DestinationPromptConfig = {
  role?: string;                 // 役割定義
  authorProfile?: string;        // 著者プロフィール
  audience?: string;             // ターゲット読者
  tone?: string;                 // 文体・トーン
  dos?: string;                  // 必須事項 (1項目1行)
  donts?: string;                // 禁事項 (1項目1行)
  structure?: string;            // 構造ルール
  cta?: string;                  // CTA 指示
  platformConstraints?: string;  // プラットフォーム固有制約
  customNotes?: string;          // 自由メモ・補足指示
};

export type ResolvedPrompt = {
  source: "custom" | "housewife-default";
  systemPrompt: string;
};

// prompt_config が項目1つでも入っていれば「設定済」とみなす
export function isPromptConfigConfigured(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as DestinationPromptConfig;
  return Boolean(
    c.role?.trim() ||
      c.authorProfile?.trim() ||
      c.audience?.trim() ||
      c.tone?.trim() ||
      c.dos?.trim() ||
      c.donts?.trim() ||
      c.structure?.trim() ||
      c.cta?.trim() ||
      c.platformConstraints?.trim() ||
      c.customNotes?.trim(),
  );
}

// 項目別の prompt_config を1つのテキストに連結する
export function buildSystemPromptFromConfig(cfg: DestinationPromptConfig): string {
  const sections: string[] = [];
  const push = (heading: string, body?: string) => {
    if (!body?.trim()) return;
    sections.push(`## ${heading}\n${body.trim()}`);
  };
  push("役割", cfg.role);
  push("著者プロフィール", cfg.authorProfile);
  push("ターゲット読者", cfg.audience);
  push("文体・トーン", cfg.tone);
  push("必須事項", cfg.dos);
  push("禁事項", cfg.donts);
  push("構造ルール", cfg.structure);
  push("CTA 指示", cfg.cta);
  push("プラットフォーム固有制約", cfg.platformConstraints);
  push("補足", cfg.customNotes);
  return sections.join("\n\n");
}

// destination + project から記事生成用 system prompt を解決する。
// - prompt_config が設定済 → 項目を連結してカスタムプロンプトを返す
// - 空 && project.kind === "housewife" → 既存の主婦デフォルトテンプレ
// - それ以外 → null (記事生成不可、呼び出し側で 400 を返す)
export function resolveSystemPrompt(
  destination: PostingDestinationRow,
  projectPersona: ProjectPersonaConfig,
): ResolvedPrompt | null {
  const cfg = (destination.prompt_config ?? {}) as DestinationPromptConfig;
  if (isPromptConfigConfigured(cfg)) {
    return {
      source: "custom",
      systemPrompt: buildSystemPromptFromConfig(cfg),
    };
  }
  if (projectPersona.kind === "housewife") {
    return {
      source: "housewife-default",
      systemPrompt: ARTICLE_SYSTEM,
    };
  }
  return null;
}

// 「プロンプトが入っていません」エラー時に UI へ返すメッセージ
export const PROMPT_NOT_CONFIGURED_ERROR =
  "投稿先のプロンプトが設定されていません。設定画面で記事生成プロンプトを設定してください。";
