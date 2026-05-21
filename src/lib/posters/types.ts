// クライアント/サーバー双方で安全に import できる型・定数のみを定義する。
// 投稿アダプタ本体 (node:crypto などサーバー専用 API を使う) は
// `./hatena` 等で実装し、`./index.ts` 経由でサーバーからのみ import する。

// note は Chrome 拡張経由で投稿するが、prompt_config を持つために
// destination として登録する。各 project に1個自動投入される。
export type Platform = "hatena" | "note"; // 今後 'livedoor' | 'blogger' | 'wordpress' を追加

export type PostingDestinationRow = {
  id: string;
  platform: Platform;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  prompt_config?: Record<string, unknown>;  // Phase 3C で追加。中身は DestinationPromptConfig
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
  note: "note",
};
