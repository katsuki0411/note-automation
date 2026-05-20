import { NextRequest } from "next/server";
import { createPlatform, loadPlatforms, type CreatePlatformInput } from "@/lib/platforms";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const platforms = await loadPlatforms(ctx.projectId, ctx.userId);
    return Response.json({ platforms });
  });
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as CreatePlatformInput;
      if (!body?.domain || !body?.label || !body?.category) {
        return Response.json(
          { error: "domain, label, category は必須です" },
          { status: 400 },
        );
      }
      const p = await createPlatform(ctx.projectId, ctx.userId, body);
      return Response.json({ platform: p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
