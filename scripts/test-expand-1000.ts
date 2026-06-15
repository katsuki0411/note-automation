// Stage 1 (Gemini #1) の 1000 KW 生成が動くかを最小コストで検証するスクリプト。
// JSON truncation でエラーになる場合の挙動も確認する。
// 使い方: npx tsx --env-file=.env.local scripts/test-expand-1000.ts

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

async function main() {
  if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY が未設定");
    process.exit(1);
  }
  console.log("=== Stage 1 (Gemini #1) 1000KW 生成テスト ===");

  // 第2引数で件数指定可能: npx tsx --env-file=.env.local scripts/test-expand-1000.ts 500
  const targetCount = Number(process.argv[2] ?? 500);
  const subject = "ピジョン 母乳実感";
  const seedKws = [
    "ピジョン 母乳実感 SS", "ピジョン 母乳実感 M", "ピジョン 母乳実感 違い",
    "ピジョン 母乳実感 おすすめ", "ピジョン 母乳実感 サイズ",
  ];

  const prompt = `
あなたはアフィリエイトSEOのキーワードリサーチャーです。

# ミッション
「${subject}」 から実際に Google で検索されそうな関連キーワードを **${targetCount}個** 抽出。
ジャンル: ベビー・キッズ

# シード KW (実検索データ ${seedKws.length}件)
${seedKws.map((k) => `- ${k}`).join("\n")}

これを起点に語尾・年代・シーン・組み合わせで 1000件まで網羅。

# 出力形式 (JSON のみ、フェンス禁止)
{
  "category": "ベビー・キッズ",
  "keywords": [
    {"kw":"ピジョン 母乳実感 価格","intent":"purchase","reason":"購入直前"}
  ]
}
`.trim();

  console.log(`プロンプト長: ${prompt.length} chars`);
  console.log("Gemini 2.5 Pro 呼び出し中... (60-120秒見込み)");
  const startedAt = Date.now();

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      temperature: 0.85,
      maxOutputTokens: 60000,
    },
  });

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const text = response.text ?? "";
  console.log(`\n所要時間: ${elapsed}秒`);
  console.log(`出力文字数: ${text.length} chars`);

  // truncation 検出
  const trimmedTail = text.trimEnd().slice(-50);
  console.log(`末尾50字: "${trimmedTail}"`);
  const isCleanJsonEnd = trimmedTail.endsWith("}") || trimmedTail.endsWith("]");
  console.log(`末尾が JSON 閉じ括弧: ${isCleanJsonEnd}`);

  // JSON parse 試行
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    const sliced = cleaned.slice(objStart, objEnd + 1);
    const parsed = JSON.parse(sliced) as { keywords?: Array<{ kw: string }> };
    const kwCount = parsed.keywords?.length ?? 0;
    console.log(`\n✅ JSON parse 成功`);
    console.log(`KW 件数: ${kwCount}`);
    if (kwCount > 0 && parsed.keywords) {
      console.log(`サンプル (最初の 3件):`);
      for (const k of parsed.keywords.slice(0, 3)) {
        console.log(`  - ${k.kw}`);
      }
      console.log(`サンプル (最後の 3件):`);
      for (const k of parsed.keywords.slice(-3)) {
        console.log(`  - ${k.kw}`);
      }
    }
  } catch (e) {
    console.log(`\n❌ JSON parse 失敗 → これがアプリ側でのスカウト失敗の原因`);
    console.log(`エラー: ${e instanceof Error ? e.message : e}`);
    console.log(`\n出力の末尾 200字 (truncation 確認用):`);
    console.log(text.slice(-200));
  }

  // finish_reason の確認
  // @ts-expect-error - SDK の型不足
  const candidates = response.candidates ?? [];
  if (candidates.length > 0) {
    // @ts-expect-error
    console.log(`\nfinishReason: ${candidates[0].finishReason ?? "(none)"}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
