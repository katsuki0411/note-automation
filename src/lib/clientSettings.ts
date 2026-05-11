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
