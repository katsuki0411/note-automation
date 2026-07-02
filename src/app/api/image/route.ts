import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { buildImagePrompt } from "@/lib/prompts";
import {
  loadArticles,
  updateArticleImagePath,
  updateArticleImageSpecs,
} from "@/lib/storage";
import { withProjectContext } from "@/lib/auth";
import { normalizeAspectRatio } from "@/lib/imageSpecs";
import { putArticleImage, isBlobConfigured } from "@/lib/imageStore";
import { overlayTitle } from "@/lib/imageText";

export const runtime = "nodejs";
export const maxDuration = 300;

type InlineDataPart = { inlineData?: { data?: string; mimeType?: string } };

// 画像生成。persist=true のときは Vercel Blob に保存して記事にURLを反映する
// (見出し画像→articles.image_path、本文マーカー→image_specs[marker].imageUrl)。
// persist=false のときは従来通り base64 を返すだけ (保存せずリロードで消える)。
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { articleId, subject, imagePrompt, aspectRatio, marker, persist, overlayText } =
        (await req.json()) as {
          articleId: string;
          subject?: string;
          // 本文マーカー画像を生成するとき、呼び出し側が組み立てた完全プロンプトを渡す。
          imagePrompt?: string;
          // "1.91:1" 等の任意比率。対応値へ丸める。未指定は 16:9 (見出し画像既定)。
          aspectRatio?: string;
          // 本文マーカー ("IMG-01" 等)。未指定は見出し画像扱い。
          marker?: string;
          // Blob へ保存して記事に反映するか。
          persist?: boolean;
          // 指定するとタイトル文字を画像上部にコード合成する (見出し画像用・文字化け対策)。
          overlayText?: string;
        };
      if (!articleId) {
        return Response.json({ error: "articleIdが必要です" }, { status: 400 });
      }

      const articles = await loadArticles(ctx.projectId);
      const article = articles.find((a) => a.id === articleId);
      if (!article) {
        return Response.json({ error: "記事が見つかりません" }, { status: 404 });
      }
      // imagePrompt (本文マーカー用の完全プロンプト) があればそれを優先。
      // 無ければ従来通り主題から見出し画像プロンプトを組み立てる。
      const prompt = imagePrompt?.trim()
        ? imagePrompt.trim()
        : buildImagePrompt(subject ?? article.imagePromptSubject);
      const finalAspectRatio = normalizeAspectRatio(aspectRatio);

      const ai = gemini();
      const result = await ai.models.generateContent({
        model: MODELS.image,
        contents: prompt,
        config: {
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: { aspectRatio: finalAspectRatio },
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

      // 見出し画像はタイトル文字をコード合成 (Gemini の日本語文字化けを回避)。
      let finalBase64 = base64;
      if (overlayText?.trim()) {
        try {
          finalBase64 = await overlayTitle(base64, overlayText);
        } catch (e) {
          console.error("[/api/image] overlayTitle failed:", e);
          // 合成失敗時は文字なしイラストのまま続行 (致命的にしない)
        }
      }
      const dataUrl = `data:${mimeType};base64,${finalBase64}`;

      // persist 指定かつ Blob 設定済みのときだけ保存し、記事にURLを反映する。
      // Blob 未設定時は保存をスキップし base64 のみ返す (従来どおり・リロードで消える)。
      let imageUrl: string | undefined;
      if (persist && isBlobConfigured()) {
        const key = marker?.trim() || "header";
        imageUrl = await putArticleImage(ctx.projectId, articleId, key, finalBase64);
        if (marker?.trim()) {
          const specs = (article.imageSpecs ?? []).map((s) =>
            s.marker === marker ? { ...s, imageUrl } : s,
          );
          await updateArticleImageSpecs(ctx.projectId, articleId, specs);
        } else {
          await updateArticleImagePath(ctx.projectId, articleId, imageUrl);
        }
      }

      // imageUrl (保存済み) があればそれを、無ければ base64 を返す。
      // persisted=false のとき呼び出し側は「未保存」と分かる。
      return Response.json({
        imageDataUrl: imageUrl ?? dataUrl,
        imageUrl,
        persisted: !!imageUrl,
        mimeType,
      });
    } catch (e) {
      console.error("[/api/image] failed:", e);
      const message = e instanceof Error ? e.message : "unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
