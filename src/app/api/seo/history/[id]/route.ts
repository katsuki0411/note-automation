import { NextRequest } from "next/server";
import { getHistory } from "@/lib/seoRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const history = await getHistory(id);
  return Response.json({ history });
}
