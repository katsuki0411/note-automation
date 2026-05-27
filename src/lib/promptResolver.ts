import { ARTICLE_SYSTEM } from "./prompts";
import type { PostingDestinationRow } from "./posters/types";
import type { ProjectKind, ProjectPersonaConfig } from "./projects";

// destination の prompt_config の構造定義 (UI のフォーム項目と1対1)。
// 各項目はオプショナル。空オブジェクト {} の場合は fallback ロジックに従う。
export type DestinationPromptConfig = {
  role?: string;
  authorProfile?: string;
  audience?: string;
  tone?: string;
  dos?: string;
  donts?: string;
  structure?: string;
  cta?: string;
  platformConstraints?: string;
  customNotes?: string;
};

export type ResolvedPrompt = {
  source: "custom" | "housewife-default";
  systemPrompt: string;
};

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

export type ProjectContextForPrompt = {
  kind: ProjectKind;
  personaConfig: ProjectPersonaConfig;
};

// destination + project から記事生成用 system prompt を解決する。
// - prompt_config が設定済 → 項目を連結してカスタムプロンプトを返す
// - 空 && 主婦判定 → 既存の主婦デフォルトテンプレ (ARTICLE_SYSTEM)
//   主婦判定: project.kind === 'research_based' AND persona.kind === 'housewife'
//   (Phase 3 時代の互換: aff project は research_based でも housewife でないので fallback 不可)
// - それ以外 → null (記事生成不可、呼び出し側で 400 を返す)
export function resolveSystemPrompt(
  destination: PostingDestinationRow,
  project: ProjectContextForPrompt,
): ResolvedPrompt | null {
  const cfg = (destination.prompt_config ?? {}) as DestinationPromptConfig;
  if (isPromptConfigConfigured(cfg)) {
    return {
      source: "custom",
      systemPrompt: buildSystemPromptFromConfig(cfg),
    };
  }
  if (
    project.kind === "research_based" &&
    project.personaConfig.kind === "housewife"
  ) {
    return {
      source: "housewife-default",
      systemPrompt: ARTICLE_SYSTEM,
    };
  }
  return null;
}

export const PROMPT_NOT_CONFIGURED_ERROR =
  "投稿先のプロンプトが設定されていません。設定画面で記事生成プロンプトを設定してください。";
