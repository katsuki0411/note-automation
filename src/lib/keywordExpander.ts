import { gemini, MODELS } from "./gemini";

// 商品名や入力キーワードから「実際に検索されそうな関連 KW」を Gemini で生成する。
// SEO/LLMO 競合判定の元になる候補KW群を作るのが目的。

export type ExpandedKeyword = {
  kw: string;
  intent: "info" | "how-to" | "comparison" | "trouble" | "review" | "purchase";
  reason: string; // なぜこのKWを推した理由 (UI に表示する場合がある)
};

const EXPAND_PROMPT = (subject: string) => `
あなたはアフィリエイトSEOのキーワードリサーチャーです。

# ミッション
以下のお題 (商品名 / カテゴリ / フリーKW のいずれか) から、実際に Google や ChatGPT で検索されそうな関連キーワードを **8〜12個** 抽出してください。

# お題
${subject}

# 抽出ルール
- 単一語ではなく **2〜4語の複合フレーズ** を中心に
- アフィリエイトで成果が出やすい intent (比較 / 購入意欲 / 解決) を意識
- 「○○ おすすめ」「○○ 比較」「○○ 違い」「○○ 寝るとき」「○○ デメリット」「○○ 安い」など多様な切り口
- 商品名そのものより、**ユーザーが事前に検索する周辺KW** を重視
- intent は以下から選ぶ:
  - info     : 情報収集
  - how-to   : やり方
  - comparison: 比較・違い
  - trouble  : 悩み解決
  - review   : レビュー
  - purchase : 購入直前 (「価格」「最安」「中古」など)

# 出力形式 (JSON 配列のみ、前後の説明文禁止)
[
  {
    "kw": "ワイヤレスイヤホン 寝るとき おすすめ",
    "intent": "comparison",
    "reason": "睡眠特化型イヤホンの比較ニーズが定常的にある"
  }
]
`.trim();

function repairJson(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1").trim();
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("JSON配列が見つかりません");
  cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(repairJson(cleaned));
  }
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

export async function expandKeywords(subject: string): Promise<ExpandedKeyword[]> {
  const trimmed = subject.trim();
  if (!trimmed) throw new Error("subject が空です");

  const ai = gemini();
  const response = await ai.models.generateContent({
    model: MODELS.research,
    contents: EXPAND_PROMPT(trimmed),
    config: {
      temperature: 0.85,
      maxOutputTokens: 4000,
    },
  });
  const text = response.text ?? "";
  const raw = extractJson(text) as Array<{
    kw?: string;
    intent?: string;
    reason?: string;
  }>;

  return raw
    .filter((r) => r?.kw && r.kw.trim())
    .map((r) => ({
      kw: r.kw!.trim(),
      intent: clampIntent(r.intent),
      reason: r.reason ?? "",
    }))
    .slice(0, 12);
}
