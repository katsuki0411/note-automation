import { NextRequest } from "next/server";
import { getKeywordTrends } from "@/lib/trends";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { keyword, days } = (await req.json()) as { keyword: string; days?: number };
    if (!keyword?.trim()) {
      return Response.json({ error: "keywordが必要" }, { status: 400 });
    }
    const result = await getKeywordTrends(keyword.trim(), days ?? 90);
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
