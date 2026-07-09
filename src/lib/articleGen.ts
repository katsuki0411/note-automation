import { claude, CLAUDE_MODEL } from "./claude";
import { gemini } from "./gemini";

export type ArticleModel = "claude" | "gemini";

// デフォルトは Claude Opus 4.8 (2026-07-09 社長指示で Gemini から切替。品質優先)
export const DEFAULT_ARTICLE_MODEL: ArticleModel = "claude";

export const GEMINI_ARTICLE_MODEL = "gemini-2.5-pro" as const;

export const ARTICLE_MODEL_OPTIONS: ReadonlyArray<{
  id: ArticleModel;
  label: string;
  description: string;
}> = [
  {
    id: "claude",
    label: "Claude Opus 4.8",
    description: "デフォルト。文章品質が高い（記事単価 約80円）",
  },
  {
    id: "gemini",
    label: "Gemini 2.5 Pro",
    description: "節約オプション。高速・長文対応（記事単価 約30円）",
  },
];

export function isArticleModel(value: unknown): value is ArticleModel {
  return value === "claude" || value === "gemini";
}

async function callClaudeText(opts: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const message = await claude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens,
    thinking: { type: "adaptive" },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (message.stop_reason === "refusal") {
    throw new Error("Claudeが生成を拒否しました (stop_reason: refusal)");
  }
  const textBlock = message.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude応答にテキストブロックがありません");
  }
  return textBlock.text;
}

export async function generateArticleJsonText(opts: {
  model: ArticleModel;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 12000;

  if (opts.model === "claude") {
    return callClaudeText({ system: opts.system, user: opts.user, maxTokens });
  }

  const response = await gemini().models.generateContent({
    model: GEMINI_ARTICLE_MODEL,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      maxOutputTokens: maxTokens,
    },
  });
  const text = response.text;
  if (!text) {
    throw new Error("Gemini応答にテキストがありません");
  }
  return text;
}

/**
 * 3段プロンプトチェーンの中間段で使う text 出力版。
 * JSON フォーマット強制をせず、生のテキスト (markdown 想定) を返す。
 * 最終段では generateArticleJsonText を使って JSON 構造化する。
 */
export async function generateArticleTextChain(opts: {
  model: ArticleModel;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 12000;
  if (opts.model === "claude") {
    return callClaudeText({ system: opts.system, user: opts.user, maxTokens });
  }
  const response = await gemini().models.generateContent({
    model: GEMINI_ARTICLE_MODEL,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: maxTokens,
    },
  });
  const text = response.text;
  if (!text) {
    throw new Error("Gemini応答にテキストがありません");
  }
  return text;
}
