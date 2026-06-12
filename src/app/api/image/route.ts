import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { buildImagePrompt } from "@/lib/prompts";
import { loadArticles } from "@/lib/storage";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type InlineDataPart = { inlineData?: { data?: string; mimeType?: string } };

// 2026-06-12: Supabase Storage への保存を廃止 (容量制限超過のため)。
// 画像は base64 を直接フロントに返却 → ユーザーが投稿先 (note 等) に直接
// アップロードする運用に。永続化は articles テーブルにも保存しない。
// 再表示したい場合は再生成 (Gemini 課金は発生するが Storage 容量問題は回避)。
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { articleId, subject } = (await req.json()) as {
        articleId: string;
        subject?: string;
      };
      if (!articleId) {
        return Response.json({ error: "articleIdが必要です" }, { status: 400 });
      }

      const articles = await loadArticles(ctx.projectId);
      const article = articles.find((a) => a.id === articleId);
      if (!article) {
        return Response.json({ error: "記事が見つかりません" }, { status: 404 });
      }
      const finalSubject = subject ?? article.imagePromptSubject;
      const prompt = buildImagePrompt(finalSubject);

      const ai = gemini();
      const result = await ai.models.generateContent({
        model: MODELS.image,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: { aspectRatio: "16:9" },
        },
      });

      const parts: InlineDataPart[] =
        result.candidates?.[0]?.content?.parts ?? [];
      const inlinePart = parts.find((p) => p.inlineData?.data);
      const base64 = inlinePart?.inlineData?.data;
      const mimeType = inlinePart?.inlineData?.mimeType ?? "image/png";
      if (!base64) {
        const finishReason = result.candidates?.[0]?.finishReason;
        const textPart = parts
          .map((p) => (p as { text?: string }).text)
          .filter(Boolean)
          .join(" ");
        throw new Error(
          `画像生成に失敗: ${finishReason ?? "no image"} ${textPart || ""}`.trim(),
        );
      }

      // base64 のまま data URL でフロントに返す (Storage 保存はしない)
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return Response.json({ imageDataUrl: dataUrl, mimeType });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
