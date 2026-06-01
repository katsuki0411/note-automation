import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/products/scout/history/[id]
// 履歴1件を candidates 含めて取得 (UI で過去結果を再表示する用)
export async function GET(_req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    const { id } = await params;
    const rows = await sql<
      {
        id: string;
        subject: string;
        candidate_count: number;
        candidates: unknown;
        created_at: string;
      }[]
    >`
      select id, subject, candidate_count, candidates, created_at
      from product_scout_history
      where id = ${id} and project_id = ${ctx.projectId}
      limit 1
    `;
    const row = rows[0];
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      id: row.id,
      subject: row.subject,
      candidateCount: row.candidate_count,
      candidates: row.candidates,
      createdAt: row.created_at,
    });
  });
}

// DELETE /api/products/scout/history/[id]
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    const { id } = await params;
    await sql`
      delete from product_scout_history
      where id = ${id} and project_id = ${ctx.projectId}
    `;
    return Response.json({ ok: true });
  });
}
