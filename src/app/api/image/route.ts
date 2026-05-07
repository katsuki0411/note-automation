import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { buildImagePrompt } from "@/lib/prompts";
import { loadArticles, saveArticle, saveImage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { articleId, subject } = (await req.json()) as {
      articleId: string;
      subject?: string;
    };
    if (!articleId) {
      return Response.json({ error: "articleIdが必要です" }, { status: 400 });
    }

    const articles = await loadArticles();
    const article = articles.find((a) => a.id === articleId);
    if (!article) {
      return Response.json({ error: "記事が見つかりません" }, { status: 404 });
    }
    const finalSubject = subject ?? article.imagePromptSubject;
    const prompt = buildImagePrompt(finalSubject);

    const ai = gemini();
    const fallbackModels = [
      MODELS.image,
      "imagen-4.0-generate-001",
      "imagen-4.0-ultra-generate-001",
    ];
    let base64: string | undefined;
    let lastErr: unknown;
    for (const model of fallbackModels) {
      try {
        const result = await ai.models.generateImages({
          model,
          prompt,
          config: { numberOfImages: 1, aspectRatio: "16:9" },
        });
        base64 = result.generatedImages?.[0]?.image?.imageBytes;
        if (base64) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!base64) {
      throw new Error(
        `画像生成に失敗: ${lastErr instanceof Error ? lastErr.message : "image bytes empty"}`
      );
    }

    const imagePath = await saveImage(articleId, base64);
    article.imagePath = imagePath;
    await saveArticle(article);

    return Response.json({ imagePath });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
