// @ts-expect-error google-trends-api has no official types
import googleTrends from "google-trends-api";
import type { ThemeId } from "./types";

export type TrendDataPoint = { date: string; value: number };
export type RelatedQueryItem = { query: string; value?: number };
export type TrendsResult = {
  keyword: string;
  interestOverTime: TrendDataPoint[];
  relatedTop: RelatedQueryItem[];
  relatedRising: RelatedQueryItem[];
  fetchedAt: string;
};

export type HotKeyword = {
  kw: string;
  source: string;
  themeId: ThemeId;
  growthHint?: string;
};

const SEED_KEYWORDS_BY_THEME: Record<ThemeId, string[]> = {
  renraku: ["保育園 連絡", "病院 予約", "欠席連絡", "習い事 振替"],
  schedule: ["家族 予定", "送迎", "スケジュール 共有"],
  paperwork: ["プリント 整理", "PTA", "連絡帳"],
  money: ["家計簿", "ふるさと納税", "ポイ活 主婦"],
  custom: [],
};

function safeParse(s: unknown): unknown {
  if (typeof s === "object") return s;
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function getKeywordTrends(keyword: string, days = 90): Promise<TrendsResult> {
  const startTime = new Date(Date.now() - days * 86400 * 1000);
  const fetchedAt = new Date().toISOString();

  const interestRaw = await googleTrends
    .interestOverTime({ keyword, geo: "JP", hl: "ja", startTime })
    .catch(() => null);
  const relatedRaw = await googleTrends
    .relatedQueries({ keyword, geo: "JP", hl: "ja" })
    .catch(() => null);

  const interestParsed = (safeParse(interestRaw) as {
    default?: { timelineData?: Array<{ formattedAxisTime?: string; value?: number[] }> };
  }) ?? {};
  const interestOverTime: TrendDataPoint[] = (interestParsed.default?.timelineData ?? []).map((p) => ({
    date: p.formattedAxisTime ?? "",
    value: p.value?.[0] ?? 0,
  }));

  const relatedParsed = (safeParse(relatedRaw) as {
    default?: {
      rankedList?: Array<{ rankedKeyword?: Array<{ query?: string; value?: number }> }>;
    };
  }) ?? {};
  const ranked = relatedParsed.default?.rankedList ?? [];
  const relatedTop: RelatedQueryItem[] = (ranked[0]?.rankedKeyword ?? []).map((r) => ({
    query: r.query ?? "",
    value: r.value,
  }));
  const relatedRising: RelatedQueryItem[] = (ranked[1]?.rankedKeyword ?? []).map((r) => ({
    query: r.query ?? "",
    value: r.value,
  }));

  return {
    keyword,
    interestOverTime,
    relatedTop,
    relatedRising,
    fetchedAt,
  };
}

export async function discoverHotKeywords(themeId: ThemeId): Promise<HotKeyword[]> {
  const seeds = SEED_KEYWORDS_BY_THEME[themeId] ?? [];
  const all: HotKeyword[] = [];
  for (const seed of seeds) {
    try {
      const trends = await getKeywordTrends(seed, 30);
      for (const r of trends.relatedRising.slice(0, 8)) {
        if (!r.query) continue;
        all.push({
          kw: r.query,
          source: seed,
          themeId,
          growthHint: r.value && r.value > 5000 ? "急上昇" : "上昇中",
        });
      }
    } catch {
      // 個別失敗はスキップ
    }
  }
  // dedupe by kw
  const seen = new Set<string>();
  return all.filter((h) => {
    if (seen.has(h.kw)) return false;
    seen.add(h.kw);
    return true;
  });
}

export const TRENDS_AVAILABLE = true;
