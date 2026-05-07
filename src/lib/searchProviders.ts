/**
 * 主婦悩み相談系のプラットフォームから実URL+実スニペットを取得する。
 * Brave Search API + Google Custom Search API を並列実行→重複排除。
 */

import { getEnabledDomains, platformLabelForDomainAsync } from "./platforms";

export type SearchProviderName = "brave" | "google";

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  provider: SearchProviderName;
  domain: string;
};

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const GOOGLE_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const cleaned = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (!/^utm_|^fbclid|^gclid|^mc_|^_ga/i.test(k)) cleaned.set(k, v);
    }
    u.search = cleaned.toString();
    u.hostname = u.hostname.replace(/^www\./, "");
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.hostname}${pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

export async function braveSearch(
  query: string,
  opts: { count?: number } = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const count = Math.min(opts.count ?? 10, 20);
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("country", "JP");
  url.searchParams.set("search_lang", "jp");
  url.searchParams.set("ui_lang", "ja-JP");
  url.searchParams.set("safesearch", "off");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    type BraveItem = { url?: string; title?: string; description?: string };
    const items: BraveItem[] = data?.web?.results ?? [];
    return items
      .filter((r) => !!r.url)
      .map((r) => ({
        url: r.url!,
        title: r.title ?? "",
        snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
        provider: "brave" as const,
        domain: getDomain(r.url!),
      }));
  } catch {
    return [];
  }
}

export async function googleCseSearch(
  query: string,
  opts: { count?: number } = {},
): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) return [];
  const count = Math.min(opts.count ?? 10, 10);
  const url = new URL(GOOGLE_CSE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(count));
  url.searchParams.set("hl", "ja");
  url.searchParams.set("gl", "jp");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    type CseItem = { link?: string; title?: string; snippet?: string };
    const items: CseItem[] = data?.items ?? [];
    return items
      .filter((it) => !!it.link)
      .map((it) => ({
        url: it.link!,
        title: it.title ?? "",
        snippet: it.snippet ?? "",
        provider: "google" as const,
        domain: getDomain(it.link!),
      }));
  } catch {
    return [];
  }
}

/**
 * 複数クエリを両プロバイダで並列実行し、URL正規化＋重複削除して返す
 */
export async function multiSearch(
  queries: string[],
  opts: { perQueryCount?: number } = {},
): Promise<SearchResult[]> {
  const perQueryCount = opts.perQueryCount ?? 5;
  const tasks: Promise<SearchResult[]>[] = [];
  for (const q of queries) {
    tasks.push(braveSearch(q, { count: perQueryCount }));
    tasks.push(googleCseSearch(q, { count: perQueryCount }));
  }
  const results = (await Promise.all(tasks)).flat();
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const key = normalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...r, url: key });
  }
  return deduped;
}

export function isProviderAvailable(p: SearchProviderName): boolean {
  if (p === "brave") return !!process.env.BRAVE_SEARCH_API_KEY;
  if (p === "google") return !!(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID);
  return false;
}

/**
 * テーマ別の検索クエリを生成。複数プラットフォーム × 複数キーワードで網羅。
 * targetPlatforms 指定が無ければ data/platforms.json の有効ドメインを使用。
 */
export async function buildSearchQueriesAsync(
  themeKeywords: string[],
  options: { maxQueries?: number; targetPlatforms?: string[] } = {},
): Promise<string[]> {
  const max = options.maxQueries ?? 6;
  const platforms = options.targetPlatforms ?? (await getEnabledDomains()).slice(0, 5);
  const queries: string[] = [];
  for (const kw of themeKeywords) {
    for (const platform of platforms) {
      queries.push(`site:${platform} ${kw}`);
      if (queries.length >= max) return queries;
    }
  }
  return queries;
}

/**
 * 検索結果フィルタ用: 有効プラットフォームのドメインのみ通す
 */
export async function getAllowedPlatformDomains(): Promise<string[]> {
  return getEnabledDomains();
}

/** 同期版: ドメインから既知のラベルを推定（非同期不要のUI表示用フォールバック） */
export function platformLabelForDomain(domain: string): string {
  // searchProviders は同期API残存だが、本来は async版を使う
  return domain;
}

export { platformLabelForDomainAsync };
