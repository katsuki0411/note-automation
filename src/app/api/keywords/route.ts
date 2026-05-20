import { NextRequest } from "next/server";
import {
  createKeyword,
  loadKeywords,
  type CreateKeywordInput,
} from "@/lib/keywords";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const state = await loadKeywords(ctx.projectId);
    return Response.json(state);
  });
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as CreateKeywordInput;
      if (!body?.kw || !body?.themeId || !body?.subcategoryId) {
        return Response.json(
          { error: "kw, themeId, subcategoryId は必須です" },
          { status: 400 },
        );
      }
      const kw = await createKeyword(ctx.projectId, ctx.userId, body);
      return Response.json({ keyword: kw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
