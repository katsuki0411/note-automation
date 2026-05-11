import { NextRequest } from "next/server";
import {
  discoverHotKeywordsForTheme,
  verifyHotKeywords,
  type HotKeyword,
} from "@/lib/hotKeywords";
import { THEMES, type ThemeId } from "@/lib/types";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type HotKeywordRow = {
  id: string;
  kw: string;
  theme_id: ThemeId;
  volume_hint: HotKeyword["volumeHint"];
  competition_hint: HotKeyword["competitionHint"];
  rise_status: HotKeyword["riseStatus"];
  intent: HotKeyword["intent"];
  priority: number;
  pain_intensity: 1 | 2 | 3 | 4 | 5;
  why_hot: string;
  sources: string[];
  discovered_at: string;
  verified_hits: number | null;
  verified_at: string | null;
  verify_status: HotKeyword["verifyStatus"] | null;
  sample_urls: string[] | null;
};

function rowToHot(r: HotKeywordRow): HotKeyword {
  return {
    kw: r.kw,
    themeId: r.theme_id,
    volumeHint: r.volume_hint,
    competitionHint: r.competition_hint,
    riseStatus: r.rise_status,
    intent: r.intent,
    priority: r.priority,
    painIntensity: r.pain_intensity,
    whyHot: r.why_hot ?? "",
    sources: r.sources ?? [],
    discoveredAt: r.discovered_at,
    verifiedHits: r.verified_hits ?? undefined,
    verifiedAt: r.verified_at ?? undefined,
    verifyStatus: r.verify_status ?? undefined,
    sampleUrls: r.sample_urls ?? undefined,
  };
}

async function loadFromDb() {
  const [rows, meta] = await Promise.all([
    sql<HotKeywordRow[]>`
      select kw, theme_id, volume_hint, competition_hint, rise_status, intent,
             priority, pain_intensity, why_hot, sources, discovered_at,
             verified_hits, verified_at, verify_status, sample_urls
      from hot_keywords
      order by verified_hits desc nulls last, priority desc
    `,
    sql<{ updated_at: string | null; stats: HotKeywordStats | null }[]>`
      select updated_at, stats from hot_keywords_meta where id = 1
    `,
  ]);
  return {
    updatedAt: meta[0]?.updated_at ?? null,
    keywords: rows.map(rowToHot),
    stats: meta[0]?.stats ?? null,
  };
}

type HotKeywordStats = {
  candidatesTotal: number;
  verified: number;
  noHits: number;
  searchFailed: number;
};

export async function GET() {
  const data = await loadFromDb();
  return Response.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      themeId?: ThemeId;
      skipVerify?: boolean;
    };
    const targetThemes = body.themeId
      ? THEMES.filter((t) => t.id === body.themeId)
      : THEMES;

    // Phase 1: 候補発掘
    const results = await Promise.allSettled(
      targetThemes.map((t) => discoverHotKeywordsForTheme(t.id)),
    );
    const candidates: HotKeyword[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") candidates.push(...r.value);
    }

    // Phase 2: 検証
    let final: HotKeyword[];
    const stats: HotKeywordStats = {
      candidatesTotal: candidates.length,
      verified: 0,
      noHits: 0,
      searchFailed: 0,
    };

    if (body.skipVerify) {
      final = candidates;
    } else {
      const verified = await verifyHotKeywords(candidates, { concurrency: 5 });
      for (const k of verified) {
        if (k.verifyStatus === "verified") stats.verified++;
        else if (k.verifyStatus === "no-hits") stats.noHits++;
        else if (k.verifyStatus === "search-failed") stats.searchFailed++;
      }
      final = verified.filter((k) => k.verifyStatus !== "no-hits");
    }

    final.sort((a, b) => {
      const ah = a.verifiedHits ?? -1;
      const bh = b.verifiedHits ?? -1;
      return bh - ah || b.priority - a.priority;
    });

    // DBに保存（差し替え）
    if (body.themeId) {
      // 該当テーマだけ削除
      await sql`delete from hot_keywords where theme_id = ${body.themeId}`;
    } else {
      await sql`delete from hot_keywords`;
    }

    for (const h of final) {
      await sql`
        insert into hot_keywords (
          kw, theme_id, volume_hint, competition_hint, rise_status, intent,
          priority, pain_intensity, why_hot, sources, discovered_at,
          verified_hits, verified_at, verify_status, sample_urls
        ) values (
          ${h.kw}, ${h.themeId}, ${h.volumeHint}, ${h.competitionHint}, ${h.riseStatus}, ${h.intent},
          ${h.priority}, ${h.painIntensity}, ${h.whyHot ?? ""},
          ${sql.json(h.sources ?? [])},
          ${h.discoveredAt},
          ${h.verifiedHits ?? null},
          ${h.verifiedAt ?? null},
          ${h.verifyStatus ?? null},
          ${h.sampleUrls ? sql.json(h.sampleUrls) : null}
        )
        on conflict (kw, theme_id) do update set
          volume_hint = excluded.volume_hint,
          competition_hint = excluded.competition_hint,
          rise_status = excluded.rise_status,
          intent = excluded.intent,
          priority = excluded.priority,
          pain_intensity = excluded.pain_intensity,
          why_hot = excluded.why_hot,
          sources = excluded.sources,
          discovered_at = excluded.discovered_at,
          verified_hits = excluded.verified_hits,
          verified_at = excluded.verified_at,
          verify_status = excluded.verify_status,
          sample_urls = excluded.sample_urls
      `;
    }

    const now = new Date().toISOString();
    await sql`
      update hot_keywords_meta
      set updated_at = ${now}, stats = ${sql.json(stats)}
      where id = 1
    `;

    return Response.json({ updatedAt: now, keywords: final, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
