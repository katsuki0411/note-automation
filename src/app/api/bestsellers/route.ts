import { withProjectContext } from "@/lib/auth";
import { loadBestsellers } from "@/lib/bestsellers";
import { BESTSELLER_CATEGORIES } from "@/lib/amazonBestseller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 現プロジェクトの全カテゴリのベストセラー商品を返す。
// レスポンス: { categories: [{id, label, items: [BestsellerProductRow]}] }
export async function GET() {
  return withProjectContext(async (ctx) => {
    const rows = await loadBestsellers(ctx.projectId);
    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byCategory.get(r.category) ?? [];
      arr.push(r);
      byCategory.set(r.category, arr);
    }
    const categories = BESTSELLER_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      urlPath: c.urlPath,
      items: byCategory.get(c.id) ?? [],
    }));
    return Response.json({ categories });
  });
}
