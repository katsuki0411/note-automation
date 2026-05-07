import { NextRequest } from "next/server";
import { discoverHotKeywordsForTheme } from "@/lib/hotKeywords";
import type { ThemeId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const { themeId } = (await req.json()) as { themeId: ThemeId };
    if (!themeId) return Response.json({ error: "themeId required" }, { status: 400 });
    const hot = await discoverHotKeywordsForTheme(themeId);
    return Response.json({ themeId, count: hot.length, hot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
