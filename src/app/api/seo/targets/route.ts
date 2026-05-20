import { NextRequest } from "next/server";
import { createTarget, listTargetsWithLatest, type CreateTargetInput } from "@/lib/seoRank";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const targets = await listTargetsWithLatest(ctx.projectId);
    return Response.json({ targets });
  });
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as CreateTargetInput;
      if (!body?.kw || !body?.targetUrlPrefix) {
        return Response.json({ error: "kw, targetUrlPrefix は必須です" }, { status: 400 });
      }
      const target = await createTarget(ctx.projectId, ctx.userId, body);
      return Response.json({ target });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 400 });
    }
  });
}
