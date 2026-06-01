import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/products/scout/history?limit=20
// 商品スカウト履歴の一覧 (新しい順)。candidates の中身は重いので一覧では返さない。
export async function GET(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    const u = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(u.searchParams.get("limit") ?? "20", 10), 1), 100);
    const rows = await sql<
      { id: string; subject: string; candidate_count: number; created_at: string }[]
    >`
      select id, subject, candidate_count, created_at
      from product_scout_history
      where project_id = ${ctx.projectId}
      order by created_at desc
      limit ${limit}
    `;
    return Response.json({ history: rows });
  });
}
