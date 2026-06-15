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

// 2026-06-15: 1000 KW スカウトモード対応に拡張。Stage 0 シード (DFS Related/Suggestions
// で 800-1000件取得) を起点に、Gemini が補完・派生 KW を加えて maxKeywords まで網羅。
// 「漏れなく広く取って Stage 3 で精査」 する方針。
const EXPAND_PROMPT = (subject: string, excludeKws: string[], seedKeywords: string[], maxKeywords: number) => `
あなたはアフィリエイトSEOのキーワードリサーチャーです。

# ミッション
以下のお題 (商品名 / カテゴリ / フリーKW のいずれか) から:
1. 実際に Google や ChatGPT で検索されそうな関連キーワードを **${Math.floor(maxKeywords * 0.8)}〜${maxKeywords}個** 抽出
2. このお題が属するジャンルを以下から1つ選ぶ:
   ${SCOUT_CATEGORIES.join(" / ")}

後段で Google Ads Search Volume + SERP 分析で絞り込むため、「漏れなく広く」 母集団を作るのが狙いです。
質より量を優先しつつも、subject と関係ない KW は混入させない。

# お題
${subject}
${seedKeywords.length > 0 ? `\n# 実際に Google で検索されている関連KW (DFS Related + Suggestions 由来、実検索データ ${seedKeywords.length}件)\n以下はあなたの想像ではなく、実際に検索されているフレーズです。\n**これらを起点・参考にして** 語尾・年代・シーン・組み合わせを変えて ${maxKeywords}件まで拡張してください\n(シード自体も該当するなら結果に含めて OK。シードに無い切り口を必ず補完すること):\n${seedKeywords.map((k) => `- ${k}`).join("\n")}` : ""}

# 抽出方針 (CVKW 中心戦略)
- 🎯 **CVKW (購入直前/比較検討KW) を全体の 70% 以上にする** ⭐最重要
  - 強CVKW (購入直前) を全体の 40% 以上:
    "○○ 価格" / "○○ 最安" / "○○ amazon" / "○○ 楽天" / "○○ 通販" /
    "○○ 在庫" / "○○ クーポン" / "○○ セール" / "○○ 正規品" /
    "○○ どこで売ってる" / "○○ 販売店" / "○○ ふるさと納税" / "○○ お買い得"
  - 中CVKW (比較検討) を全体の 30% 以上:
    "○○ おすすめ" / "○○ 比較" / "○○ 違い" / "○○ 口コミ" / "○○ レビュー" /
    "○○ ランキング" / "○○ 選び方" / "○○ どっち"
  - 残り 30% で情報系 (使い方/効果/口コミ等) と派生長尾 KW を補完
- **商標入りKWを必ず含める** (subject の主要トークン + 周辺KW)
- 「ユーザーが対象商品を購入する直前」のメンタルモデルで想定
- 同じ意味の言い換えを重複させない

# 抽出ルール
- 単一語ではなく **2〜4語の複合フレーズ** を中心に
- 「○○ おすすめ」「○○ 比較」「○○ 違い」「○○ いつから」「○○ デメリット」「○○ 安い」など多様な切り口
- ${maxKeywords}件出すために無理にこじつけず、本当に検索されそうなフレーズだけにする (質 ≧ 数)
- 上の「実検索KW」を超えて、想像で作る場合も実検索データに似た表現に寄せる
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

// Gemini が maxOutputTokens 到達で途中切断された JSON を修復する。
// 1000 KW モード等で出力が長くなると頻発するパターン:
//   { "category": "...", "keywords": [ {kw,intent,reason}, ..., {kw,intent,re ← ここで切れる
// → 最後の完全な } (KW エントリ閉じ) まで切り出して、後ろに ]} を補う。
function repairTruncatedJson(s: string): string {
  if (!s.startsWith("{")) return s;
  const keywordsIdx = s.indexOf('"keywords"');
  if (keywordsIdx < 0) return s;
  const arrStart = s.indexOf("[", keywordsIdx);
  if (arrStart < 0) return s;

  let depth = 0;
  let lastValidEnd = -1;
  let inString = false;
  let escape = false;
  let arrClosed = false;

  for (let i = arrStart + 1; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) lastValidEnd = i; // 1KW エントリ閉じの完全な位置
    } else if (c === "]" && depth === 0) {
      arrClosed = true;
      break;
    }
  }

  if (arrClosed) return s; // 配列正常終端 → 修復不要
  if (lastValidEnd < 0) return s; // 修復不能 (配列開始直後で切れた)
  // lastValidEnd まで切って ]} で閉じる
  return s.slice(0, lastValidEnd + 1) + "]}";
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // 後方互換: 旧プロンプトの配列 [...] と新プロンプトのオブジェクト {category, keywords:[...]} 両対応
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  const isObj = objStart !== -1 && (arrStart === -1 || objStart < arrStart);
  if (isObj) {
    const end = cleaned.lastIndexOf("}");
    if (end === -1) {
      // 末尾 } が無い = 途中切断確定 → 切断修復を試みる
      const repaired = repairTruncatedJson(cleaned.slice(objStart));
      if (repaired.endsWith("]}")) {
        cleaned = repaired;
        console.warn("[keywordExpander] JSON truncation 検出 → repairTruncatedJson で修復");
      } else {
        throw new Error("JSONオブジェクトが見つかりません (truncation 修復不能)");
      }
    } else {
      cleaned = cleaned.slice(objStart, end + 1);
    }
  } else {
    const end = cleaned.lastIndexOf("]");
    if (arrStart === -1 || end === -1) throw new Error("JSON配列が見つかりません");
    cleaned = cleaned.slice(arrStart, end + 1);
  }
  // 1次: そのまま parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // 2次: 末尾カンマ除去
    try {
      return JSON.parse(repairJson(cleaned));
    } catch {
      // 3次: truncation 修復を再試行 (cleaned が末尾切断版だった場合)
      const repaired = repairTruncatedJson(cleaned);
      console.warn("[keywordExpander] JSON parse 再失敗 → truncation 修復後に再 parse");
      return JSON.parse(repairJson(repaired));
    }
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
  customPrompt?: string; // カスタムプロンプト (placeholder: {subject} / {excludeKws} / {maxKeywords} / {seedKeywords})
                          // 指定時は EXPAND_PROMPT の代わりにこれを使う。
                          // 出力フォーマット指示は末尾に強制 append される (パース壊れ防止)。
  seedKeywords?: string[]; // Stage 0 で DFS Related/Suggestions から取得したシード KW
                            // Gemini #1 に「実検索データ」として渡してハルシ抑制
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
  const seedKeywords = opts.seedKeywords ?? [];

  // customPrompt があれば renderTemplate で展開、なければ EXPAND_PROMPT デフォルト
  const userPrompt = opts.customPrompt?.trim()
    ? renderTemplate(opts.customPrompt, {
        subject: trimmed,
        maxKeywords,
        excludeKws: excludeKws.length > 0 ? excludeKws.map((k) => `- ${k}`).join("\n") : "(なし)",
        seedKeywords:
          seedKeywords.length > 0
            ? seedKeywords.map((k) => `- ${k}`).join("\n")
            : "(シードなし)",
      }) + OUTPUT_FOOTER
    : EXPAND_PROMPT(trimmed, excludeKws, seedKeywords, maxKeywords);

  const ai = gemini();
  const startedAt = Date.now();
  const response = await ai.models.generateContent({
    model: MODELS.research,
    contents: userPrompt,
    config: {
      temperature: 0.85,
      // maxKeywords × ~100 tokens (kw + intent + reason) を見積もり、Gemini 2.5 Pro の
      // output 上限 65536 ギリギリまで使う (1000 KW モード対応)。
      maxOutputTokens: 60000,
    },
  });
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const text = response.text ?? "";
  // finishReason 確認 (MAX_TOKENS なら truncation 確実)
  const finishReason =
    (response as unknown as { candidates?: Array<{ finishReason?: string }> })
      .candidates?.[0]?.finishReason ?? "(unknown)";
  console.log(
    `[keywordExpander] Gemini #1 done: ${elapsedSec}s, ${text.length} chars, finish=${finishReason}, target=${maxKeywords}KW`,
  );
  if (finishReason === "MAX_TOKENS") {
    console.warn(
      `[keywordExpander] Gemini #1 が maxOutputTokens=60000 に到達 → JSON 末尾が truncate されてる可能性。truncation 修復で部分結果を取得試行`,
    );
  }
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
