import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { fetchKeywordMetrics } from "@/lib/ahrefs";

export const runtime = "nodejs";

// POST /api/products/scout/refine
// body: { kw: string }
// → Ahrefs API で KD / 検索Vol / CPC を取得して返す
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { kw?: string };
      if (!body.kw?.trim()) {
        return Response.json({ error: "kw が必要です" }, { status: 400 });
      }
      const metrics = await fetchKeywordMetrics(ctx.userId, body.kw.trim());
      return Response.json({ metrics });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "失敗" },
        { status: 500 },
      );
    }
  });
}
