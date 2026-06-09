import { ARTICLE_SYSTEM } from "./prompts";
import type { PostingDestinationRow } from "./posters/types";
import type { ProjectKind, ProjectPersonaConfig } from "./projects";

// destination の prompt_config の構造定義。
// 2026-06-09 拡張: stages (3段プロンプトチェーン) を追加。
// 既存の 10項目 (role/authorProfile/...) は後方互換のため残置 (UI からは編集できない)。
// 優先度: stages > 旧10項目 > housewife-default > null
export type DestinationPromptConfig = {
  // 新: 3段プロンプトチェーン (destination 単位)
  stages?: [string, string, string];
  // 旧: 10項目構造化スキーマ (後方互換、UIからは編集不可)
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

/**
 * destination の prompt_config.stages から有効な3段プロンプトを取り出す。
 * いずれかの段に文字列が入っていれば返す。全段空なら null。
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

export type ResolvedPrompt = {
  source: "custom" | "housewife-default";
  systemPrompt: string;
};

export function isPromptConfigConfigured(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as DestinationPromptConfig;
  // 新: stages のいずれかに有効値があれば configured
  if (Array.isArray(c.stages) && c.stages.some((s) => typeof s === "string" && s.trim())) {
    return true;
  }
  // 旧: 10項目のいずれかに有効値があれば configured (後方互換)
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
