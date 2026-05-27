// クライアント / サーバーどちらでも安全に import できる型・定数のみ。
// サーバー専用ロジック (DB アクセスを含む) は ./projects.ts に置く。

export type ProjectKind = "research_based" | "amazon_affiliate" | "a8_affiliate";

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  research_based: "情報源リサーチ型",
  amazon_affiliate: "Amazon アフィ型",
  a8_affiliate: "A8 アフィ型",
};

export const PROJECT_KIND_DESCRIPTION: Record<ProjectKind, string> = {
  research_based:
    "知恵袋・ガルちゃん・ママスタ等の悩み相談から元ネタを抽出して解決記事を書く従来型 (例: syuhu)",
  amazon_affiliate:
    "Amazon の商品・売れ筋から記事ネタを起こして紹介・レビュー・比較記事を書く",
  a8_affiliate:
    "A8.net の案件・広告主から記事ネタを起こしてサービス紹介・比較記事を書く",
};

export type ProjectPersonaKind = "housewife" | "affiliate" | "blog" | "other";

export type ProjectPersonaConfig = {
  kind?: ProjectPersonaKind;
  author_concept?: string[];
  themes?: string[];
  kgi?: string;
};

export type ProjectRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: ProjectKind;
  persona_config: ProjectPersonaConfig;
  created_at: string;
  updated_at: string;
};

export type ProjectMembership = ProjectRow & {
  role: "owner" | "editor" | "viewer";
};

export function isValidKind(k: string): k is ProjectKind {
  return k === "research_based" || k === "amazon_affiliate" || k === "a8_affiliate";
}
