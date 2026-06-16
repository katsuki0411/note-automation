import {
  countPersonalBlogsInSerp,
  hasPersonalSiteInAiOverview,
} from "./domainClassifier";

// =========================================================
// お宝スコア (Treasure Score) — 2026-06-15 設計 (KD 軸なし版)
// =========================================================
// 「1スカウト最低1個はお宝を掘り当てたい」 という事業の本質目的を機械化する複合スコア。
//
// 当初は KD を中核軸に置く設計だったが、DFS Backlinks の日本語ロングテール KW
// カバレッジが薄く実用性に欠けるため、KD 軸は撤廃 (2026-06-15)。
// 将来 Backlinks 再契約 or Ahrefs 導入時に KD 軸を復活する場合は git 履歴の
// commit (お宝スコア導入時) を参照。
//
// 4軸の合算 (最大 70点):
//   - SV     (最大 30) ★ 流入ボリューム
//   - CVKW   (最大 20)   購入意図の強さ (cvKw.ts の cvKwScore × 0.2)
//   - SERP個人ブログ含有 (最大 15) ★ 実勝率の証拠
//   - AI Overview個人サイト (+5 ボーナス) LLMO シグナル
//
// ランク判定 (70点満点でリスケール、2026-06-16 緩和):
//   45+ : 💎💎💎 超お宝 (64%以上)
//   30+ : 💎💎 お宝 (43%以上)
//   20+ : 💎 準お宝 (29%以上)
//   <20 : 通常採用
// 緩和理由: Amazon商品スカウトだと SERP個人ブログ判定 0件 が多発、お宝判定到達が困難
// だったため (旧50/35/25 だと 0件採用が頻発)。Stage 5 にハード保証ロジックも併用。
// =========================================================

export type TreasureRank = "treasure3" | "treasure2" | "treasure1" | "normal";

export type TreasureBreakdownItem = {
  value: number | string | null;
  points: number;
  reason: string;
};

export type TreasureBreakdown = {
  sv: TreasureBreakdownItem;
  cvKw: TreasureBreakdownItem;
  serp: TreasureBreakdownItem;
  aiOverview: TreasureBreakdownItem;
};

export type TreasureScore = {
  total: number;          // 合計 (0-70)
  rank: TreasureRank;
  breakdown: TreasureBreakdown;
};

export type CalcTreasureArgs = {
  searchVolume: number | null;
  cvKwScore: number;             // 0-100
  serpTopUrls: string[];         // SERP organic Top10 の URL 配列
  aiOverviewUrls: string[];      // AI Overview 引用元の URL 配列
  subject: string;               // 商品名 (official 判定に使う)
};

// ---------- 各軸の計算 ----------

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
  if (total >= 45) return "treasure3";
  if (total >= 30) return "treasure2";
  if (total >= 20) return "treasure1";
  return "normal";
}

// ---------- メイン ----------

export function calcTreasureScore(args: CalcTreasureArgs): TreasureScore {
  const sv = scoreSv(args.searchVolume);
  const cvKw = scoreCvKw(args.cvKwScore);
  const serp = scoreSerp(args.serpTopUrls, args.subject);
  const aiOverview = scoreAiOverview(args.aiOverviewUrls, args.subject);

  const total = sv.points + cvKw.points + serp.points + aiOverview.points;

  return {
    total,
    rank: decideRank(total),
    breakdown: { sv, cvKw, serp, aiOverview },
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
