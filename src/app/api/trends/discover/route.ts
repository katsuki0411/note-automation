import { NextRequest } from "next/server";
import { discoverHotKeywords } from "@/lib/trends";
import type { ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  return withProjectContext(async () => {
    try {
      const { themeId } = (await req.json()) as { themeId: ThemeId };
      if (!themeId) return Response.json({ error: "themeIdが必要" }, { status: 400 });
      const hot = await discoverHotKeywords(themeId);
      return Response.json({ themeId, hot });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
