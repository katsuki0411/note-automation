import {
  ARTICLE_MODEL_OPTIONS,
  DEFAULT_ARTICLE_MODEL,
  isArticleModel,
  type ArticleModel,
} from "./articleGen";

export const ARTICLE_MODEL_STORAGE_KEY = "note-automation:articleModel";

export { ARTICLE_MODEL_OPTIONS, DEFAULT_ARTICLE_MODEL };
export type { ArticleModel };

export function readArticleModel(): ArticleModel {
  if (typeof window === "undefined") return DEFAULT_ARTICLE_MODEL;
  const stored = window.localStorage.getItem(ARTICLE_MODEL_STORAGE_KEY);
  return isArticleModel(stored) ? stored : DEFAULT_ARTICLE_MODEL;
}

export function writeArticleModel(model: ArticleModel): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ARTICLE_MODEL_STORAGE_KEY, model);
}

// ===== 記事生成後の画像自動生成トグル =====
// 本文テキスト完成後に、見出し画像 / 本文画像を自動生成して Blob 保存するか。
// コスト直結 (約6円/枚) のため既定は両方 OFF。単発・バッチ双方に適用される。
export const AUTO_IMAGE_STORAGE_KEY = "note-automation:autoImages";

export type AutoImageSettings = {
  header: boolean; // 見出し画像を自動生成
  body: boolean; // 本文中の [IMG] 画像を自動生成
};

export const DEFAULT_AUTO_IMAGE_SETTINGS: AutoImageSettings = {
  header: false,
  body: false,
};

export function readAutoImageSettings(): AutoImageSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUTO_IMAGE_SETTINGS };
  try {
    const raw = window.localStorage.getItem(AUTO_IMAGE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTO_IMAGE_SETTINGS };
    const p = JSON.parse(raw) as Partial<AutoImageSettings>;
    return { header: !!p.header, body: !!p.body };
  } catch {
    return { ...DEFAULT_AUTO_IMAGE_SETTINGS };
  }
}

export function writeAutoImageSettings(s: AutoImageSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_IMAGE_STORAGE_KEY, JSON.stringify(s));
}

// ===== 自分の記事URL（前方一致用） =====
// SEO順位チェックで「自分の記事」を判定するためのURL登録。
// 設定ページで登録し、/seo の追加フォームでプルダウン選択する。

export const ARTICLE_URLS_STORAGE_KEY = "note-automation:articleUrls";

export type ArticleUrl = {
  id: string;
  label: string;
  urlPrefix: string;
};

function isArticleUrl(v: unknown): v is ArticleUrl {
  if (typeof v !== "object" || v == null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.label === "string" && typeof r.urlPrefix === "string";
}

export function readArticleUrls(): ArticleUrl[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ARTICLE_URLS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArticleUrl);
  } catch {
    return [];
  }
}

export function writeArticleUrls(urls: ArticleUrl[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ARTICLE_URLS_STORAGE_KEY, JSON.stringify(urls));
}
