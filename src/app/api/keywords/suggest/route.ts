import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { SUBCATEGORIES, THEMES, type ThemeId } from "@/lib/types";
import { AUTHOR_CONCEPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("JSON配列が見つかりません");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const SUGGEST_PROMPT = (themeLabel: string, themeDesc: string, subcategoryLabel: string) => `
あなたはSEO/LLMO戦略のキーワードリサーチャーです。

${AUTHOR_CONCEPT}

【今回のミッション】
テーマ「${themeLabel}」のサブカテゴリ「${subcategoryLabel}」で、主婦が実際にGoogle検索／ChatGPTで質問しそうなキーワードを **10件** 提案してください。

【テーマの説明】
${themeDesc}

【条件】
- 個人開発ツール（LINE bot/Webツール/PC常駐ツール）で解決可能な悩みに紐づくKW
- 短すぎる単一語は避け、「主婦 ○○」「○○ 解決」「○○ 簡単 やり方」など複合フレーズ優先
- intent は info(情報収集) / how-to(やり方) / comparison(比較) / trouble(悩み解決) のいずれか
- vol/comp は感覚値で OK（high/medium/low/niche）
- priority は 1〜100 の総合スコア（vol高 × comp低 × pain高 を重視）

出力は必ず以下のJSON配列のみ（前後の説明文禁止）:
[
  {
    "kw": "保育園 連絡帳 めんどくさい",
    "intent": "trouble",
    "vol": "medium",
    "comp": "low",
    "priority": 80,
    "memo": "毎朝の連絡帳ストレス・LINE bot で代行できる"
  }
]
`.trim();

export async function POST(req: NextRequest) {
  try {
    const { themeId, subcategoryId } = (await req.json()) as {
      themeId: ThemeId;
      subcategoryId: string;
    };
    const theme = THEMES.find((t) => t.id === themeId);
    if (!theme) return Response.json({ error: "themeId不正" }, { status: 400 });
    const sub = (SUBCATEGORIES[themeId] ?? []).find((s) => s.id === subcategoryId);
    if (!sub) return Response.json({ error: "subcategoryId不正" }, { status: 400 });

    const ai = gemini();
    const response = await ai.models.generateContent({
      model: MODELS.research,
      contents: SUGGEST_PROMPT(theme.label, theme.desc, sub.label),
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.85,
        maxOutputTokens: 4096,
      },
    });
    const text = response.text ?? "";
    const suggestions = extractJson(text) as Array<{
      kw: string;
      intent?: string;
      vol?: string;
      comp?: string;
      priority?: number;
      memo?: string;
    }>;

    return Response.json({ suggestions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
