// =========================================================
// Mock 商品メタ - PA-API 取得前の UI 動作確認用
// =========================================================
// ASIN をシードにした疑似乱数で価格・レビュー数・評価を生成する。
// 同じ ASIN なら毎回同じ値になるので、画面リロードしても整合性が保たれる。
// PA-API 取得後は実データに置き換える。
// =========================================================

import { feesRateForCategory } from "./productScoring";

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export type MockProductMeta = {
  price: number;
  rating: number;
  reviewCount: number;
  feesRate: number;
  isMock: true;
};

export function generateMockProductMeta(
  asin: string,
  category?: string | null,
): MockProductMeta {
  const seed = hashCode(asin);
  // 価格 980〜29,880 円 (300ステップ)
  const price = 980 + (seed % 300) * 100;
  // ★ 3.0〜4.9
  const rating = Math.round((3.0 + ((seed >> 4) % 20) / 10) * 10) / 10;
  // レビュー 50〜5,050
  const reviewCount = 50 + ((seed >> 8) % 50) * 100;
  return {
    price,
    rating,
    reviewCount,
    feesRate: feesRateForCategory(category),
    isMock: true,
  };
}
