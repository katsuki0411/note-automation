import { claude, CLAUDE_MODEL } from "./claude";
import { gemini } from "./gemini";

export type ArticleModel = "claude" | "gemini";

// デフォルトは Gemini 2.5 Pro (Claude は別途 Anthropic クレジット課金が必要なため)
export const DEFAULT_ARTICLE_MODEL: ArticleModel = "gemini";

export const GEMINI_ARTICLE_MODEL = "gemini-2.5-pro" as const;

export const ARTICLE_MODEL_OPTIONS: ReadonlyArray<{
  id: ArticleModel;
  label: string;
  description: string;
}> = [
  {
    id: "gemini",
    label: "Gemini 2.5 Pro",
    description: "デフォルト。高速・無料枠あり・長文対応",
  },
  {
    id: "claude",
    label: "Claude Fable 5",
    description: "Anthropic最上位モデル。クレジット必要、最高品質（Gemini比で記事単価 約160円）",
  },
];

export function isArticleModel(value: unknown): value is ArticleModel {
  return value === "claude" || value === "gemini";
}

// Fable 5 は安全分類器が稀に誤検知で拒否する (stop_reason: "refusal") ため、
// サーバー側フォールバックで Opus 4.8 に同一リクエスト内で自動リトライさせる。
async function callClaudeText(opts: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const message = await claude().beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
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
