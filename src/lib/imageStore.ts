import "server-only";
import { put } from "@vercel/blob";

// =========================================================
// 記事画像の永続保存 (Vercel Blob, 2026-07-01)
// =========================================================
// 見出し画像・本文マーカー画像を Blob に保存し公開URLを返す。
// 2026-06-12 に廃止した Supabase Storage (無料1GB上限) の代替。
// パス: articles/<projectId>/<articleId>/<key>.png  (key = "header" or "IMG-01")
// 再生成は allowOverwrite で同一パスを上書きし、URL 末尾に ?v=<ts> を付けて
// ブラウザキャッシュを無効化する。
// =========================================================

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function putArticleImage(
  projectId: string,
  articleId: string,
  key: string,
  base64: string,
): Promise<string> {
  if (!isBlobConfigured()) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN が未設定です。Vercel で Blob ストアを作成し、トークンを .env.local と本番環境変数に設定してください。",
    );
  }
  const buffer = Buffer.from(base64, "base64");
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_");
  const pathname = `articles/${projectId}/${articleId}/${safeKey}.png`;
  const { url } = await put(pathname, buffer, {
    access: "public",
    contentType: "image/png",
    allowOverwrite: true,
  });
  return `${url}?v=${Date.now()}`;
}
