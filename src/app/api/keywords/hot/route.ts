import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { discoverHotKeywordsForTheme, type HotKeyword } from "@/lib/hotKeywords";
import { THEMES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CACHE_FILE = path.join(process.cwd(), "data", "hot-keywords.json");

type HotCache = {
  updatedAt: string;
  keywords: HotKeyword[];
};

async function loadCache(): Promise<HotCache | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCache(c: HotCache): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(c, null, 2), "utf-8");
}

export async function GET() {
  const cache = await loadCache();
  return Response.json(cache ?? { updatedAt: null, keywords: [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { themeId?: string };
    const targetThemes = body.themeId
      ? THEMES.filter((t) => t.id === body.themeId)
      : THEMES;

    const results = await Promise.allSettled(
      targetThemes.map((t) => discoverHotKeywordsForTheme(t.id)),
    );

    const merged: HotKeyword[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") merged.push(...r.value);
    }
    merged.sort((a, b) => b.priority - a.priority);

    const cache: HotCache = {
      updatedAt: new Date().toISOString(),
      keywords: merged,
    };
    await saveCache(cache);
    return Response.json(cache);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
