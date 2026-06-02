import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import { gemini, MODELS } from "@/lib/gemini";
import { SCOUT_CATEGORIES, type ScoutCategory } from "@/lib/keywordExpander";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/products/scout/history/backfill-category
// category=null の履歴を一括で Gemini に推定させて埋める。
// Gemini に subject の配列を渡して JSON で複数返してもらう (1回のリクエストで全件処理)。
export async function POST() {
  return withProjectContext(async (ctx) => {
    const rows = await sql<{ id: string; subject: string }[]>`
      select id, subject from product_scout_history
      where project_id = ${ctx.projectId} and category is null
      order by created_at desc
    `;
    if (rows.length === 0) {
      return Response.json({ updated: 0, message: "未分類の履歴はありません" });
    }

    const ai = gemini();
    const prompt = `
以下の商品名 / お題リストに対して、それぞれが属するジャンルを下記から1つずつ選んで JSON で返してください。

# ジャンル候補
${SCOUT_CATEGORIES.join(" / ")}

# 入力 (id, subject)
${rows.map((r, i) => `${i + 1}. id=${r.id} | ${r.subject}`).join("\n")}

# 出力フォーマット (JSON 配列のみ、前後の説明文禁止)
[
  { "id": "uuid", "category": "ベビー・キッズ" },
  ...
]
`.trim();

    try {
      const res = await ai.models.generateContent({
        model: MODELS.research,
        contents: prompt,
        config: { temperature: 0.2, maxOutputTokens: 4000 },
      });
      const text = res.text ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start === -1 || end === -1) throw new Error("JSON配列が見つかりません");
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Array<{
        id?: string;
        category?: string;
      }>;

      const updates = parsed.filter(
        (p) =>
          p.id &&
          p.category &&
          (SCOUT_CATEGORIES as readonly string[]).includes(p.category),
      );

      let updated = 0;
      for (const u of updates) {
        await sql`
          update product_scout_history
          set category = ${u.category as ScoutCategory}
          where id = ${u.id!} and project_id = ${ctx.projectId} and category is null
        `;
        updated++;
      }
      return Response.json({
        updated,
        total: rows.length,
        message: `${updated}/${rows.length} 件の履歴にカテゴリを推定して保存しました`,
      });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "推定失敗" },
        { status: 500 },
      );
    }
  });
}
