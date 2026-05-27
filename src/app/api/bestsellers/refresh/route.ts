import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import {
  fetchAllBestsellers,
  fetchBestsellersForCategory,
  BESTSELLER_CATEGORIES,
} from "@/lib/amazonBestseller";
import { replaceBestsellersForCategory } from "@/lib/bestsellers";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/bestsellers/refresh
// body (任意): { category?: string }
//   - category 指定なし → 全カテゴリ並列で取得 + 保存
//   - category 指定あり → そのカテゴリだけ取得 + 保存
//
// レスポンス: { results: [{category, fetched, error?}] }
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { category } = (await req.json().catch(() => ({}))) as { category?: string };

      if (category) {
        const cat = BESTSELLER_CATEGORIES.find((c) => c.id === category);
        if (!cat) return Response.json({ error: `unknown category: ${category}` }, { status: 400 });
        try {
          const items = await fetchBestsellersForCategory(cat);
          const inserted = await replaceBestsellersForCategory(
            ctx.projectId,
            ctx.userId,
            cat.id,
            items,
          );
          return Response.json({
            results: [{ category: cat.id, fetched: inserted }],
          });
        } catch (e) {
          return Response.json(
            {
              results: [
                {
                  category: cat.id,
                  fetched: 0,
                  error: e instanceof Error ? e.message : "unknown",
                },
              ],
            },
            { status: 500 },
          );
        }
      }

      // 全カテゴリ
      const fetched = await fetchAllBestsellers({ concurrency: 2 });
      const results = [];
      for (const r of fetched) {
        if (r.error) {
          results.push({ category: r.category.id, fetched: 0, error: r.error });
          continue;
        }
        try {
          const inserted = await replaceBestsellersForCategory(
            ctx.projectId,
            ctx.userId,
            r.category.id,
            r.items,
          );
          results.push({ category: r.category.id, fetched: inserted });
        } catch (e) {
          results.push({
            category: r.category.id,
            fetched: 0,
            error: e instanceof Error ? e.message : "unknown",
          });
        }
      }
      return Response.json({ results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
