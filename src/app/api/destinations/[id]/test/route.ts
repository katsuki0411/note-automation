import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { getDestination } from "@/lib/destinations";
import { testDestinationConnection } from "@/lib/posters/connectionTest";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  return withProjectContext(async (ctx) => {
    const { id } = await params;
    const dest = await getDestination(ctx.projectId, id);
    if (!dest) return Response.json({ error: "not found" }, { status: 404 });
    const result = await testDestinationConnection(dest);
    return Response.json(result);
  });
}
