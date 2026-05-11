import { claude, CLAUDE_MODEL } from "./claude";
import { gemini } from "./gemini";

export type ArticleModel = "claude" | "gemini";

export const DEFAULT_ARTICLE_MODEL: ArticleModel = "claude";

export const GEMINI_ARTICLE_MODEL = "gemini-2.5-pro" as const;

export const ARTICLE_MODEL_OPTIONS: ReadonlyArray<{
  id: ArticleModel;
  label: string;
  description: string;
}> = [
  {
    id: "claude",
    label: "Claude Sonnet 4.6",
    description: "デフォルト。長文構成・繊細な日本語に強い",
  },
  {
    id: "gemini",
    label: "Gemini 2.5 Pro",
    description: "代替モデル。高速で大容量",
  },
];

export function isArticleModel(value: unknown): value is ArticleModel {
  return value === "claude" || value === "gemini";
}

export async function generateArticleJsonText(opts: {
  model: ArticleModel;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const maxTokens = opts.maxTokens ?? 12000;

  if (opts.model === "claude") {
    const message = await claude().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const textBlock = message.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude応答にテキストブロックがありません");
    }
    return textBlock.text;
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
