import type { Article, ImageSpec } from "./types";
import type { AutoImageSettings } from "./clientSettings";
import {
  buildMarkerImagePrompt,
  splitHeaderAndBodySpecs,
  extractOverlayText,
} from "./imageSpecs";

// =========================================================
// 記事生成後の画像 自動生成 (client, 2026-07-01)
// =========================================================
// 本文テキスト完成後に、トグルで選ばれた種別 (見出し / 本文) の画像を
// /api/image (persist=true) で順に生成し Blob 保存する。単発・バッチ双方から使う。
// 見出し画像 → articles.image_path、本文画像 → image_specs[marker].imageUrl に反映。
// =========================================================

export type AutoImageResult = {
  headerUrl?: string;
  markerUrls: Record<string, string>; // marker → 保存済みURL
  errors: string[];
};

async function generateOne(
  articleId: string,
  spec: ImageSpec | undefined,
  marker: string | undefined,
  overlayText?: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    // 見出し画像 (marker 無し) は文字なしイラスト＋タイトルをコード合成。
    const noText = !marker;
    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId,
        marker,
        persist: true,
        imagePrompt: spec ? buildMarkerImagePrompt(spec, { noText }) : undefined,
        aspectRatio: spec?.aspectRatio,
        overlayText,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "失敗");
    return (data.imageUrl as string | undefined) ?? (data.imageDataUrl as string) ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * article の imageSpecs から、settings で選ばれた画像を順に生成・保存する。
 * サーバ側で永続化されるので戻り値は state 即時反映用 (無視してもDBには残る)。
 */
export async function autoGenerateArticleImages(
  article: Article,
  settings: AutoImageSettings,
  onProgress?: (done: number, total: number) => void,
): Promise<AutoImageResult> {
  const specs = article.imageSpecs ?? [];
  const { header, body } = splitHeaderAndBodySpecs(specs);

  const jobs: {
    spec?: ImageSpec;
    marker?: string;
    kind: "header" | "body";
    overlayText?: string;
  }[] = [];
  if (settings.header && header) {
    jobs.push({
      spec: header,
      marker: undefined,
      kind: "header",
      overlayText: extractOverlayText(header, article.bestTitle),
    });
  }
  if (settings.body) {
    for (const s of body) jobs.push({ spec: s, marker: s.marker, kind: "body" });
  }

  const result: AutoImageResult = { markerUrls: {}, errors: [] };
  let done = 0;
  for (const job of jobs) {
    const url = await generateOne(article.id, job.spec, job.marker, job.overlayText);
    done += 1;
    onProgress?.(done, jobs.length);
    if (!url) {
      result.errors.push(`${job.marker ?? "見出し画像"} の生成に失敗`);
      continue;
    }
    if (job.kind === "header") result.headerUrl = url;
    else if (job.marker) result.markerUrls[job.marker] = url;
  }
  return result;
}

/** settings で1枚でも自動生成対象があるか。 */
export function hasAutoImageWork(article: Article, settings: AutoImageSettings): boolean {
  if (!settings.header && !settings.body) return false;
  const specs = article.imageSpecs ?? [];
  if (specs.length === 0) return false;
  const { header, body } = splitHeaderAndBodySpecs(specs);
  return (settings.header && !!header) || (settings.body && body.length > 0);
}
