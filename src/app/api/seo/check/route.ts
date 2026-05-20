import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { checkAllEnabled, checkTarget } from "@/lib/seoRank";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type TargetRow = {
  id: string;
  kw: string;
  target_url_prefix: string;
  memo: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { id?: string };
      if (body?.id) {
        const rows = await sql<TargetRow[]>`
          select id, kw, target_url_prefix, memo, enabled, created_at, updated_at
          from seo_targets
          where id = ${body.id} and project_id = ${ctx.projectId}
          limit 1
        `;
        if (rows.length === 0) return Response.json({ error: "not found" }, { status: 404 });
        const r = rows[0];
        const result = await checkTarget(ctx.projectId, {
          id: r.id,
          kw: r.kw,
          targetUrlPrefix: r.target_url_prefix,
          memo: r.memo ?? "",
          enabled: r.enabled,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        });
        return Response.json({ ranking: result });
      }
      const summary = await checkAllEnabled(ctx.projectId);
      return Response.json(summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
