// =========================================================
// 記事ごとの詳細条件 (Phase 3, 2026-06-29)
// =========================================================
// 3段プロンプトの「対策キーワード・記事条件」ブロックにある任意の {{...}} 欄を、
// 記事生成のたびに UI から埋めるための共通定義。
//   プロンプト側は `secondary_keywords: {{サブKW・関連KW（任意）}}` のように
//   `lineKey: {{ラベル}}` 行形式になっており、ペルソナの writer_* 注入と同じく
//   行ごと実値に置換する。
//   target_keyword は generate 側で別途自動注入されるためここには含めない。
//   writer_* (執筆者プロフィール) はペルソナ機能が担当するためここには含めない。
// 全項目任意。未指定の行は最終的に「（指定なし）」へ無害化される (従来挙動)。
// =========================================================

export type DetailConditions = {
  secondaryKeywords?: string;
  searchIntent?: string;
  articleGoal?: string;
  targetReader?: string;
  charCount?: string;
  ctaUrl?: string;
  mustInclude?: string;
  mustAvoid?: string;
};

export type DetailConditionField = {
  key: keyof DetailConditions;
  lineKey: string; // プロンプト内の `lineKey: {{...}}` 行のキー
  label: string;
  placeholder: string;
  multiline?: boolean;
};

export const DETAIL_CONDITION_FIELDS: DetailConditionField[] = [
  {
    key: "secondaryKeywords",
    lineKey: "secondary_keywords",
    label: "サブKW・関連KW",
    placeholder: "例: 名前付け グッズ / お名前シール 防水",
  },
  {
    key: "searchIntent",
    lineKey: "search_intent_hint",
    label: "想定する検索意図",
    placeholder: "例: 保育園の名前付けを手早く済ませたい",
  },
  {
    key: "articleGoal",
    lineKey: "article_goal",
    label: "記事のゴール",
    placeholder: "例: おすすめ商品を比較して購入につなげる",
  },
  {
    key: "targetReader",
    lineKey: "target_reader_hint",
    label: "想定読者の補足",
    placeholder: "例: 1〜2歳児を保育園に預け始めるママ",
  },
  {
    key: "charCount",
    lineKey: "target_char_count",
    label: "目標文字数",
    placeholder: "例: 8000（未指定なら自動決定）",
  },
  {
    key: "ctaUrl",
    lineKey: "cta_url",
    label: "誘導先・公式/キャンペーンURL",
    placeholder: "https://...",
  },
  {
    key: "mustInclude",
    lineKey: "must_include",
    label: "必ず含めたい論点",
    placeholder: "例: 食洗機OKかどうか / 名前が消えにくいか",
    multiline: true,
  },
  {
    key: "mustAvoid",
    lineKey: "must_avoid",
    label: "避けたい論点",
    placeholder: "例: 高すぎる商品 / 在庫切れ品",
    multiline: true,
  },
];

/**
 * 3段プロンプトの1ステージ分テキストに対し、詳細条件の各 `lineKey:` 行を実値で埋める。
 * - 値が空の項目はスキップ (後段の {{}} 掃除で「（指定なし）」化される)。
 * - 改行は「／」に畳んで1行に収める (行形式を壊さないため)。
 * - gm フラグ: 1ステージ内に同じ行が複数あれば全て置換。
 */
export function applyDetailConditions(
  stageText: string,
  dc?: DetailConditions | null,
): string {
  if (!dc) return stageText;
  let t = stageText;
  for (const f of DETAIL_CONDITION_FIELDS) {
    const raw = dc[f.key];
    const v = raw ? raw.trim().replace(/\s*\n\s*/g, " ／ ") : "";
    if (!v) continue;
    t = t.replace(new RegExp(`^(\\s*${f.lineKey}:).*$`, "gm"), `$1 ${v}`);
  }
  return t;
}

/** 1つでも値が入っていれば true (UI のバッジ表示や送信判定用)。 */
export function hasAnyDetailCondition(dc?: DetailConditions | null): boolean {
  if (!dc) return false;
  return DETAIL_CONDITION_FIELDS.some((f) => !!dc[f.key]?.trim());
}
