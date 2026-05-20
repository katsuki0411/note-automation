// クライアント/サーバー双方で安全に import できる型・定数のみを定義する。
// 投稿アダプタ本体 (node:crypto などサーバー専用 API を使う) は
// `./hatena` 等で実装し、`./index.ts` 経由でサーバーからのみ import する。

export type Platform = "hatena"; // 今後 'livedoor' | 'blogger' | 'wordpress' を追加

export type PostingDestinationRow = {
  id: string;
  platform: Platform;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
};

export type PostArticleInput = {
  title: string;
  bodyMarkdown: string;
  tags?: string[];
  draft?: boolean;
  imageUrl?: string;
};

export type PostArticleResult = {
  ok: boolean;
  url?: string;
  editUrl?: string;
  error?: string;
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  hatena: "はてなブログ",
};
