import { NextRequest } from "next/server";
import {
  createKeyword,
  loadKeywords,
  type CreateKeywordInput,
} from "@/lib/keywords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await loadKeywords();
  return Response.json(state);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateKeywordInput;
    if (!body?.kw || !body?.themeId || !body?.subcategoryId) {
      return Response.json(
        { error: "kw, themeId, subcategoryId は必須です" },
        { status: 400 },
      );
    }
    const kw = await createKeyword(body);
    return Response.json({ keyword: kw });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
