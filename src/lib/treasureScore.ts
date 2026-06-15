import {
  countPersonalBlogsInSerp,
  hasPersonalSiteInAiOverview,
} from "./domainClassifier";

// =========================================================
// お宝スコア (Treasure Score) — 2026-06-15 設計
// =========================================================
// 「個人ブログで本当に勝てる + アクセス取れる KW」 を機械的に発掘するための
// 複合スコア。Backlinks 契約により KD 実数値が取れるようになった前提。
//
// 設計の出発点:
//   「1スカウト最低1個はお宝を掘り当てたい」 (アリーさん談)
//
// 5軸の合算 (最大 110点 / 通常 100点満点):
//   - KD     (最大 40) ★ SEO 勝率の最大指標
//   - SV     (最大 30) ★ 流入ボリューム
//   - CVKW   (最大 20)   購入意図の強さ (cvKw.ts の cvKwScore × 0.2)
//   - SERP個人ブログ含有 (最大 15) ★ 実勝率の証拠
//   - AI Overview個人サイト (+5 ボーナス) LLMO シグナル
//
// ランク判定:
//   80+ : 💎💎💎 超お宝
//   60-79: 💎💎 お宝
//   40-59: 💎 準お宝
//   <40 : 通常採用
// =========================================================

export type TreasureRank = "treasure3" | "treasure2" | "treasure1" | "normal";

export type TreasureBreakdownItem = {
  value: number | string | null; // 元値 (KD=18, SV=1200, "個人ブログ3件" 等)
  points: number;                 // 加点
  reason: string;                 // UI に出す説明文 (例: "個人ブログで2-4ヶ月で勝てる")
};

export type TreasureBreakdown = {
  kd: TreasureBreakdownItem;
  sv: TreasureBreakdownItem;
  cvKw: TreasureBreakdownItem;
  serp: TreasureBreakdownItem;
  aiOverview: TreasureBreakdownItem;
};

export type TreasureScore = {
  total: number;          // 合計 (0-110)
  rank: TreasureRank;
  breakdown: TreasureBreakdown;
};

export type CalcTreasureArgs = {
  kd: number | null;
  searchVolume: number | null;
  cvKwScore: number;             // 0-100
  serpTopUrls: string[];         // SERP organic Top10 の URL 配列
  aiOverviewUrls: string[];      // AI Overview 引用元の URL 配列
  subject: string;               // 商品名 (official 判定に使う)
};

// ---------- 各軸の計算 ----------

function scoreKd(kd: number | null): TreasureBreakdownItem {
  if (kd === null) {
    return {
      value: null,
      points: 0,
      reason:
        "KD未取得 (この KW は DFS Labs インデックスに無し / SV+CVKW+SERPで評価)",
    };
  }
  if (kd <= 10) {
    return { value: kd, points: 40, reason: `KD=${kd}: 個人ブログで1-2ヶ月で上位狙える超優良` };
  }
  if (kd <= 20) {
    return { value: kd, points: 30, reason: `KD=${kd}: 個人ブログで2-4ヶ月で勝てる現実的ライン` };
  }
  if (kd <= 30) {
    return { value: kd, points: 15, reason: `KD=${kd}: 中堅メディアと混在、6ヶ月戦略要` };
  }
  return { value: kd, points: 0, reason: `KD=${kd}: 大手寡占、個人では困難` };
}

function scoreSv(sv: number | null): TreasureBreakdownItem {
  if (sv === null || sv === 0) {
    return { value: sv, points: 0, reason: "SV未取得 or ゼロ" };
  }
  if (sv >= 5000) {
    return { value: sv, points: 30, reason: `SV=${sv.toLocaleString()}: ジャックポット (1記事で主力化)` };
  }
  if (sv >= 1000) {
    return { value: sv, points: 20, reason: `SV=${sv.toLocaleString()}: 本物のお宝ボリューム` };
  }
  if (sv >= 500) {
    return { value: sv, points: 10, reason: `SV=${sv.toLocaleString()}: アクセス取れる最低限` };
  }
  if (sv >= 100) {
    return { value: sv, points: 5, reason: `SV=${sv.toLocaleString()}: ロングテール (CVKW 高なら救済)` };
  }
  return { value: sv, points: 0, reason: `SV=${sv.toLocaleString()}: ノイズ寄り` };
}

function scoreCvKw(cvKwScore: number): TreasureBreakdownItem {
  const points = Math.round(cvKwScore * 0.2);
  let label = "非CVKW";
  if (cvKwScore >= 70) label = "強CVKW (購入クリック直結)";
  else if (cvKwScore >= 50) label = "中CVKW (比較検討段階)";
  else if (cvKwScore >= 30) label = "弱CVKW (情報収集寄り)";
  return {
    value: cvKwScore,
    points,
    reason: `CVKW=${cvKwScore} → ${label}`,
  };
}

function scoreSerp(
  serpTopUrls: string[],
  subject: string,
): TreasureBreakdownItem {
  const count = countPersonalBlogsInSerp(serpTopUrls, subject);
  if (count >= 4) {
    return {
      value: `個人ブログ${count}件`,
      points: 15,
      reason: `SERP Top10 に個人ブログ ${count}件 = ほぼ確実に勝てる証拠`,
    };
  }
  if (count >= 2) {
    return {
      value: `個人ブログ${count}件`,
      points: 10,
      reason: `SERP Top10 に個人ブログ ${count}件 = 勝てる可能性高い`,
    };
  }
  if (count >= 1) {
    return {
      value: `個人ブログ${count}件`,
      points: 5,
      reason: `SERP Top10 に個人ブログ ${count}件 = 突破口あり`,
    };
  }
  return {
    value: `個人ブログ0件`,
    points: 0,
    reason: `SERP Top10 に個人ブログなし = 大手寡占の可能性`,
  };
}

function scoreAiOverview(
  aiOverviewUrls: string[],
  subject: string,
): TreasureBreakdownItem {
  if (aiOverviewUrls.length === 0) {
    return { value: "なし", points: 0, reason: "AI Overview 未表示" };
  }
  const hasPersonal = hasPersonalSiteInAiOverview(aiOverviewUrls, subject);
  if (hasPersonal) {
    return {
      value: "個人サイト引用あり",
      points: 5,
      reason: `AI Overview が個人サイトを引用 = LLMO で個人でも戦える証拠 +5 ボーナス`,
    };
  }
  return {
    value: "大手のみ",
    points: 0,
    reason: "AI Overview は大手のみ引用",
  };
}

function decideRank(total: number): TreasureRank {
  if (total >= 80) return "treasure3";
  if (total >= 60) return "treasure2";
  if (total >= 40) return "treasure1";
  return "normal";
}

// ---------- メイン ----------

export function calcTreasureScore(args: CalcTreasureArgs): TreasureScore {
  const kd = scoreKd(args.kd);
  const sv = scoreSv(args.searchVolume);
  const cvKw = scoreCvKw(args.cvKwScore);
  const serp = scoreSerp(args.serpTopUrls, args.subject);
  const aiOverview = scoreAiOverview(args.aiOverviewUrls, args.subject);

  const total =
    kd.points + sv.points + cvKw.points + serp.points + aiOverview.points;

  return {
    total,
    rank: decideRank(total),
    breakdown: { kd, sv, cvKw, serp, aiOverview },
  };
}

// UI 用ヘルパー: ランクごとの表示属性
export const TREASURE_RANK_LABEL: Record<TreasureRank, { emoji: string; label: string; cls: string }> = {
  treasure3: {
    emoji: "💎💎💎",
    label: "超お宝",
    cls: "bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold",
  },
  treasure2: {
    emoji: "💎💎",
    label: "お宝",
    cls: "bg-emerald-100 text-emerald-800 font-bold",
  },
  treasure1: {
    emoji: "💎",
    label: "準お宝",
    cls: "bg-amber-100 text-amber-800 font-semibold",
  },
  normal: {
    emoji: "·",
    label: "通常",
    cls: "bg-gray-100 text-gray-600",
  },
};
