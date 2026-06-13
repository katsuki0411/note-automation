/**
 * CVKW (Conversion Keyword) スコア計算ロジック (2026-06-13)
 *
 * CVKW = 「購入/問い合わせ直前の検索意図」を持つキーワード。
 * 0-100 点で評価し、60+ を「CVKW として扱う」目安にする。
 * Stage 3 (Gemini #2 絞り込み) と Stage 5 (Gemini #3 最終判定) で参照される。
 */

// 強CVKW: 「これ買う直前」の検索意図を表すトークン
// 含まれていれば +30 (1 マッチで頭打ち。重複加点しない)
const STRONG_CV_TOKENS = [
  "価格", "値段", "最安", "安い",
  "amazon", "アマゾン", "楽天", "yahoo", "ヤフー", "通販",
  "在庫", "売り切れ", "クーポン", "セール", "割引",
  "買う", "購入", "売ってる", "売ってない", "販売店", "店舗",
  "どこで売", "正規品", "送料", "お得", "いくら",
  "ふるさと納税", "ポイント",
];

// 中CVKW: 「比較・検討」段階の検索意図
// 含まれていれば +15
const MID_CV_TOKENS = [
  "おすすめ", "比較", "違い", "口コミ", "レビュー", "評判",
  "ランキング", "人気", "選び方",
  "どっち", "どれ", "どれが", "vs",
];

export type CvKwScore = {
  total: number;        // 0-100 の総合スコア
  intentScore: number;  // 0-40 (Google公式 intent 由来)
  tokenScore: number;   // 0-30 (CV トークンマッチ由来)
  brandScore: number;   // 0-15 (商標含有由来)
  // 寄与した語をログ表示用に保存
  hits: { strong?: string; mid?: string; brand?: string };
};

export type CalcCvKwArgs = {
  kw: string;
  /** DFS Search Intent API が返した intent ラベル */
  googleIntent: string | null;
  /** subject から抽出した商標トークン (例: ["PIGEON", "ピジョン", "母乳実感"]) */
  brandTokens?: string[];
};

export function calcCvKwScore(args: CalcCvKwArgs): CvKwScore {
  const kwLower = args.kw.toLowerCase();
  const hits: CvKwScore["hits"] = {};

  // (1) Google公式 intent (0-40 点)
  let intentScore = 0;
  switch (args.googleIntent) {
    case "transactional":
      intentScore = 40;
      break;
    case "commercial":
      intentScore = 25;
      break;
    case "navigational":
      intentScore = 5;
      break;
    case "informational":
    default:
      intentScore = 0;
      break;
  }

  // (2) CV トークン (0-30 点)
  let tokenScore = 0;
  for (const t of STRONG_CV_TOKENS) {
    if (kwLower.includes(t.toLowerCase())) {
      tokenScore = 30;
      hits.strong = t;
      break;
    }
  }
  if (tokenScore === 0) {
    for (const t of MID_CV_TOKENS) {
      if (kwLower.includes(t.toLowerCase())) {
        tokenScore = 15;
        hits.mid = t;
        break;
      }
    }
  }

  // (3) 商標含有 (0-15 点)
  let brandScore = 0;
  for (const b of args.brandTokens ?? []) {
    if (b.length >= 2 && kwLower.includes(b.toLowerCase())) {
      brandScore = 15;
      hits.brand = b;
      break;
    }
  }

  const total = Math.min(100, intentScore + tokenScore + brandScore);
  return { total, intentScore, tokenScore, brandScore, hits };
}

/**
 * subject から商標トークン候補を抽出。
 * 例: "PIGEON ピジョン 母乳実感 乳首 1ヶ月" → ["PIGEON", "ピジョン", "母乳実感", "乳首", "1ヶ月"]
 */
export function extractBrandTokens(subject: string): string[] {
  return subject
    .split(/[\s　,、・/／]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !/^(の|を|に|が|は|で|や|と|から|まで)$/.test(t))
    // 数字単独は除外 (例: "1", "100")
    .filter((t) => !/^\d+$/.test(t));
}

/**
 * UI 表示用に CVKW スコアを「強/中/弱」に分類する目安。
 *  >= 70: 強CVKW (purchase intent 確定)
 *  >= 50: 中CVKW (commercial intent)
 *  >= 30: 弱CVKW (informational に近い)
 *  <  30: 非CVKW
 */
export function classifyCvKw(score: number): "strong" | "mid" | "weak" | "none" {
  if (score >= 70) return "strong";
  if (score >= 50) return "mid";
  if (score >= 30) return "weak";
  return "none";
}
