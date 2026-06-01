// =========================================================
// 商品リサーチ - 収益化スコアの計算
// =========================================================
// 商品ごとに「アフィリエイトで稼げる見込み」を数値化する。
// 各要素ごとに小さな関数 + breakdown オブジェクトで返す。
// UI 側 (ProductScoreBreakdown.tsx) はこの breakdown をプルダウン表示する。
// =========================================================

export type ProductScoringInput = {
  price?: number | null;          // 円
  feesRate?: number | null;       // 0.03 = 3%
  reviewCount?: number | null;
  rating?: number | null;         // 1-5
  seoCompetition?: number | null; // 0-100 (低いほど競合少)。未スカウトなら null
  alreadyPosted?: boolean;        // 既に記事化済みなら -50%
};

export type ScoreFactor = {
  label: string;       // "期待報酬" 等の人間向けラベル
  formula: string;     // "3% × 5,980円" 等の式文字列
  value: number;       // 計算結果 (数値)
  display: string;     // "179円" 等の表示用文字列
  weight: number;      // 0-1, total への寄与率
};

export type ScoreBreakdown = {
  total: number;       // 0-100 の総合スコア
  grade: "S" | "A" | "B" | "C" | "D"; // バッジ表示用ランク
  factors: ScoreFactor[];
  notes: string[];     // 「データ不足」「未スカウト」等の補足
};

function jpy(n: number): string {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function grade(total: number): ScoreBreakdown["grade"] {
  if (total >= 80) return "S";
  if (total >= 65) return "A";
  if (total >= 50) return "B";
  if (total >= 35) return "C";
  return "D";
}

/**
 * 6要素で 0-100 の収益化スコアを算出。
 *
 * - 期待報酬   (revenue):     紹介料率 × 価格        → 円換算
 * - 人気度    (popularity):  log10(レビュー数) × ★平均評価
 * - SEO余地  (seoRoom):     (100 - SEO競合度) / 100  → 0-1
 * - 未投稿   (notPosted):    投稿済なら -50%
 *
 * 各要素を 0-100 に正規化し、重み付き平均で総合スコアを出す。
 */
export function calculateProductScore(input: ProductScoringInput): ScoreBreakdown {
  const factors: ScoreFactor[] = [];
  const notes: string[] = [];

  // --- 期待報酬 (revenue) ---
  // 上限 1,000円 = 100点 として正規化
  const price = input.price ?? 0;
  const feesRate = input.feesRate ?? 0;
  const expectedRevenue = price * feesRate;
  const revenueScore = Math.min(100, (expectedRevenue / 1000) * 100);
  factors.push({
    label: "期待報酬",
    formula: price && feesRate ? `${pct(feesRate)} × ${jpy(price)}` : "(価格 or 料率 未取得)",
    value: revenueScore,
    display: expectedRevenue > 0 ? `${jpy(expectedRevenue)}/件 → ${revenueScore.toFixed(0)}点` : "—",
    weight: 0.35,
  });
  if (!price || !feesRate) notes.push("価格/紹介料率が未取得 (PA-API 取得後に埋まります)");

  // --- 人気度 (popularity) ---
  // log10(レビュー数) は 0 (0件) 〜 4 (10,000件) 程度を想定。★は1-5。
  // 4 × 5 = 20 が上限なので、20 を 100 として正規化
  const reviewCount = input.reviewCount ?? 0;
  const rating = input.rating ?? 0;
  const logReview = reviewCount > 0 ? Math.log10(reviewCount) : 0;
  const popularityRaw = logReview * rating;
  const popularityScore = Math.min(100, (popularityRaw / 20) * 100);
  factors.push({
    label: "人気度",
    formula: reviewCount && rating ? `log₁₀(${reviewCount.toLocaleString("ja-JP")}件) × ★${rating.toFixed(1)}` : "(レビュー or 評価 未取得)",
    value: popularityScore,
    display: popularityRaw > 0 ? `${popularityRaw.toFixed(1)} → ${popularityScore.toFixed(0)}点` : "—",
    weight: 0.25,
  });
  if (!reviewCount || !rating) notes.push("レビュー数/★評価が未取得");

  // --- SEO 余地 (seoRoom) ---
  // 競合度 0 = 隙間だらけ = 100点 / 競合度 100 = 大手独占 = 0点
  const seoCompetition = input.seoCompetition;
  let seoScore: number;
  if (seoCompetition == null) {
    seoScore = 50; // 未スカウト時は中央値
    notes.push("未スカウト (商品ごとのスカウトボタンで実行可)");
  } else {
    seoScore = Math.max(0, Math.min(100, 100 - seoCompetition));
  }
  factors.push({
    label: "SEO余地",
    formula: seoCompetition == null ? "未スカウト (中央値50適用)" : `100 - ${seoCompetition.toFixed(0)} (競合度)`,
    value: seoScore,
    display: `${seoScore.toFixed(0)}点`,
    weight: 0.30,
  });

  // --- 未投稿フラグ (notPosted) ---
  const notPostedScore = input.alreadyPosted ? 0 : 100;
  factors.push({
    label: "未投稿ボーナス",
    formula: input.alreadyPosted ? "既に投稿済 → 0点" : "未投稿 → 満点",
    value: notPostedScore,
    display: input.alreadyPosted ? "0点" : "100点",
    weight: 0.10,
  });

  // --- 総合スコア ---
  const total = factors.reduce((sum, f) => sum + f.value * f.weight, 0);
  const totalRounded = Math.round(Math.max(0, Math.min(100, total)));

  return {
    total: totalRounded,
    grade: grade(totalRounded),
    factors,
    notes,
  };
}

// カテゴリごとの参考紹介料率 (Amazon Associates JP 2026年時点・PA-API取得前のフォールバック用)
export const CATEGORY_FEES_RATE_FALLBACK: Record<string, number> = {
  fashion: 0.08,
  beauty: 0.08,
  kitchen: 0.04,
  electronics: 0.02,
  toys: 0.03,
  books: 0.03,
  food: 0.04,
  baby: 0.04,
  sports: 0.03,
  pet: 0.04,
  default: 0.03,
};

export function feesRateForCategory(category: string | null | undefined): number {
  if (!category) return CATEGORY_FEES_RATE_FALLBACK.default;
  return CATEGORY_FEES_RATE_FALLBACK[category] ?? CATEGORY_FEES_RATE_FALLBACK.default;
}
