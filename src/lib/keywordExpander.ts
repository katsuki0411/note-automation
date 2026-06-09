import { gemini, MODELS } from "./gemini";
import { renderTemplate } from "./promptTemplate";

// 商品名や入力キーワードから「実際に検索されそうな関連 KW」を Gemini で生成する。
// SEO/LLMO 競合判定の元になる候補KW群を作るのが目的。

export type ExpandedKeyword = {
  kw: string;
  intent: "info" | "how-to" | "comparison" | "trouble" | "review" | "purchase";
  reason: string; // なぜこのKWを推した理由 (UI に表示する場合がある)
};

// スカウト履歴のジャンル分類 (UI フィルタ用)。 Amazon AFF プロジェクトのカテゴリ感に揃える
export const SCOUT_CATEGORIES = [
  "家電・PC・ガジェット",
  "ファッション",
  "食品・飲料",
  "美容・ヘルスケア",
  "ホーム・キッチン",
  "ベビー・キッズ",
  "ペット",
  "本・電子書籍",
  "スポーツ・アウトドア",
  "車・バイク",
  "DIY・工具",
  "楽器・ホビー",
  "その他",
] as const;
export type ScoutCategory = (typeof SCOUT_CATEGORIES)[number];

export type ExpandKeywordsResult = {
  keywords: ExpandedKeyword[];
  category: ScoutCategory; // subject のジャンル推定
};

// 2026-06-07: 30件 → 100件に拡張。 拡張プラン B' のスカウト初期段で「広く取って
// DFS Bulk KD で安く絞る」ためにバッターボックスを大きく取る方針。
// Phase 5 で「設定画面でユーザー編集可能」にする予定。
const EXPAND_PROMPT = (subject: string, excludeKws: string[]) => `
あなたはアフィリエイトSEOのキーワードリサーチャーです。

# ミッション
以下のお題 (商品名 / カテゴリ / フリーKW のいずれか) から:
1. 実際に Google や ChatGPT で検索されそうな関連キーワードを **80〜100個** 抽出
2. このお題が属するジャンルを以下から1つ選ぶ:
   ${SCOUT_CATEGORIES.join(" / ")}

後段のフロー (DFS Bulk KD で安価スクリーニング → Keyword Overview で精査) で
上澄みを絞るための「広めの母数」を作るのが狙いです。

# お題
${subject}

# 抽出方針 (MTG 2026-06-07 決定)
- **商標入りKWを必ず含める** (商品名 + 周辺KW)
- **購入直前のKW (CVキーワード)** を中核に置く
   - 例: "○○ 価格", "○○ 最安", "○○ amazon", "○○ 買い方", "○○ 在庫"
- 「ユーザーが対象商品を検索する時、購入直前のKW」を必ず想定
- 同じ意味の言い換えを重複させない

# 抽出ルール
- 単一語ではなく **2〜4語の複合フレーズ** を中心に
- 「○○ おすすめ」「○○ 比較」「○○ 違い」「○○ いつから」「○○ デメリット」「○○ 安い」など多様な切り口
- 100件出すために無理にこじつけず、本当に検索されそうなフレーズだけにする (質 > 数)
- intent は以下から選ぶ:
  - info     : 情報収集
  - how-to   : やり方
  - comparison: 比較・違い
  - trouble  : 悩み解決
  - review   : レビュー
  - purchase : 購入直前 (「価格」「最安」「中古」など) ← 最優先で多く出す
${excludeKws.length > 0 ? `\n# 除外KW (以下のKWは結果に含めないこと)\n${excludeKws.map((k) => `- ${k}`).join("\n")}` : ""}

# 出力形式 (JSON オブジェクトのみ、前後の説明文禁止)
{
  "category": "家電・PC・ガジェット",
  "keywords": [
    {
      "kw": "ワイヤレスイヤホン 寝るとき おすすめ",
      "intent": "comparison",
      "reason": "睡眠特化型イヤホンの比較ニーズが定常的にある"
    }
  ]
}
`.trim();

function repairJson(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1").trim();
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // 後方互換: 旧プロンプトの配列 [...] と新プロンプトのオブジェクト {category, keywords:[...]} 両対応
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  const isObj = objStart !== -1 && (arrStart === -1 || objStart < arrStart);
  if (isObj) {
    const end = cleaned.lastIndexOf("}");
    if (end === -1) throw new Error("JSONオブジェクトが見つかりません");
    cleaned = cleaned.slice(objStart, end + 1);
  } else {
    const end = cleaned.lastIndexOf("]");
    if (arrStart === -1 || end === -1) throw new Error("JSON配列が見つかりません");
    cleaned = cleaned.slice(arrStart, end + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(repairJson(cleaned));
  }
}

function clampCategory(v: unknown): ScoutCategory {
  return (SCOUT_CATEGORIES as readonly string[]).includes(String(v))
    ? (v as ScoutCategory)
    : "その他";
}

const ALLOWED_INTENT = [
  "info",
  "how-to",
  "comparison",
  "trouble",
  "review",
  "purchase",
] as const;

function clampIntent(v: unknown): ExpandedKeyword["intent"] {
  return (ALLOWED_INTENT as readonly string[]).includes(String(v))
    ? (v as ExpandedKeyword["intent"])
    : "info";
}

export type ExpandKeywordsOptions = {
  excludeKws?: string[]; // 結果に含めないKW (プロジェクト単位の除外リスト)
  maxKeywords?: number;  // 取得上限 (デフォルト100)
  customPrompt?: string; // カスタムプロンプト (placeholder: {subject} / {excludeKws} / {maxKeywords})
                          // 指定時は EXPAND_PROMPT の代わりにこれを使う。
                          // 出力フォーマット指示は末尾に強制 append される (パース壊れ防止)。
};

// 出力フォーマット指示 (customPrompt 末尾に必ず append する)
const OUTPUT_FOOTER = `

# 出力形式 (JSON オブジェクトのみ、前後の説明文禁止)
{
  "category": "ジャンル名 (家電・PC・ガジェット / ファッション / ベビー・キッズ / ... から1つ)",
  "keywords": [
    {
      "kw": "キーワード文字列",
      "intent": "info | how-to | comparison | trouble | review | purchase のいずれか",
      "reason": "そのKWを選んだ理由"
    }
  ]
}`;

export async function expandKeywords(
  subject: string,
  opts: ExpandKeywordsOptions = {},
): Promise<ExpandKeywordsResult> {
  const trimmed = subject.trim();
  if (!trimmed) throw new Error("subject が空です");
  const excludeKws = opts.excludeKws ?? [];
  const maxKeywords = opts.maxKeywords ?? 100;

  // customPrompt があれば renderTemplate で展開、なければ EXPAND_PROMPT デフォルト
  const userPrompt = opts.customPrompt?.trim()
    ? renderTemplate(opts.customPrompt, {
        subject: trimmed,
        maxKeywords,
        excludeKws: excludeKws.length > 0 ? excludeKws.map((k) => `- ${k}`).join("\n") : "(なし)",
      }) + OUTPUT_FOOTER
    : EXPAND_PROMPT(trimmed, excludeKws);

  const ai = gemini();
  const response = await ai.models.generateContent({
    model: MODELS.research,
    contents: userPrompt,
    config: {
      temperature: 0.85,
      // 100件 × 1件あたり ~150 tokens で 15,000、安全側に余裕を持たせて 20,000
      maxOutputTokens: 20000,
    },
  });
  const text = response.text ?? "";
  const raw = extractJson(text);

  // 新形式: { category, keywords: [...] } / 旧形式 (配列のみ) 両対応
  let rawKeywords: Array<{ kw?: string; intent?: string; reason?: string }>;
  let rawCategory: unknown;
  if (Array.isArray(raw)) {
    rawKeywords = raw as Array<{ kw?: string; intent?: string; reason?: string }>;
    rawCategory = "その他";
  } else {
    const obj = raw as { category?: unknown; keywords?: unknown };
    rawKeywords = Array.isArray(obj.keywords)
      ? (obj.keywords as Array<{ kw?: string; intent?: string; reason?: string }>)
      : [];
    rawCategory = obj.category;
  }

  const excludedSet = new Set(excludeKws.map((k) => k.trim().toLowerCase()));
  const keywords = rawKeywords
    .filter((r) => r?.kw && r.kw.trim())
    .map((r) => ({
      kw: r.kw!.trim(),
      intent: clampIntent(r.intent),
      reason: r.reason ?? "",
    }))
    // Gemini が除外指示を無視した時の念のためフィルタ
    .filter((r) => !excludedSet.has(r.kw.toLowerCase()))
    .slice(0, maxKeywords);

  return {
    keywords,
    category: clampCategory(rawCategory),
  };
}
