import { NextRequest } from "next/server";
import { getHistory } from "@/lib/seoRank";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    const { id } = await routeCtx.params;
    const history = await getHistory(ctx.projectId, id);
    return Response.json({ history });
  });
}
