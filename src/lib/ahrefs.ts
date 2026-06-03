import "server-only";
import { resolveAhrefsToken } from "./integrations";

// =========================================================
// Ahrefs API クライアント
// =========================================================
// MultiPostAI の商品スカウト「深く取る」段で使う。 KD/検索Vol/CPC/DR/被リンクを取得。
// Lite プラン以上で API token が発行可能。月10,000 units (= 約200 query)。
//
// Mock モード: env AHREFS_USE_MOCK=true で固定レスポンスを返す
// (契約前の UI 動作確認用)。デフォルトは実 API。
// =========================================================

const BASE = "https://api.ahrefs.com/v3";

export type KeywordMetrics = {
  kw: string;
  keywordDifficulty: number | null; // 0-100 (難しいほど高い)
  searchVolume: number | null;       // 月間検索数
  cpc: number | null;                // クリック単価 USD
  clicksPerSearch: number | null;    // 検索あたりクリック数 (CTR的)
  globalSearchVolume?: number | null;
  source: "live" | "mock";
};

/**
 * Mock: hash ベースの再現性ある仮値
 */
function mockMetrics(kw: string): KeywordMetrics {
  let h = 0;
  for (let i = 0; i < kw.length; i++) h = (h * 31 + kw.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return {
    kw,
    keywordDifficulty: h % 80, // 0-79
    searchVolume: 100 + (h % 50) * 200, // 100-10,000
    cpc: ((h >> 4) % 200) / 10, // 0-20 USD
    clicksPerSearch: 0.3 + ((h >> 8) % 70) / 100, // 0.3-1.0
    globalSearchVolume: 200 + (h % 100) * 200,
    source: "mock",
  };
}

/**
 * 1つの KW のメタデータ (KD/Vol/CPC) を取得。
 * Ahrefs API v3 の Keyword Explorer エンドポイント。
 *
 * 注意: API クォータは1 query で50 units 以上消費。重い処理。
 * 「上澄み3〜5 KW」のピンポイント精査用途で使うこと。
 */
export async function fetchKeywordMetrics(
  userId: string,
  kw: string,
  opts: { country?: string } = {},
): Promise<KeywordMetrics> {
  if (process.env.AHREFS_USE_MOCK === "true") {
    return mockMetrics(kw);
  }

  const token = await resolveAhrefsToken(userId);
  if (!token) {
    throw new Error("Ahrefs API トークンが未設定。設定→API連携 で登録してください");
  }

  const country = opts.country ?? "jp";
  const params = new URLSearchParams({
    keyword: kw,
    country,
    select:
      "keyword,difficulty,volume,cpc,clicks_per_search,global_volume",
  });
  const res = await fetch(`${BASE}/keywords-explorer/overview?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Ahrefs API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    keyword?: {
      difficulty?: number;
      volume?: number;
      cpc?: number;
      clicks_per_search?: number;
      global_volume?: number;
    };
  };
  const k = data.keyword;
  return {
    kw,
    keywordDifficulty: k?.difficulty ?? null,
    searchVolume: k?.volume ?? null,
    cpc: k?.cpc ?? null,
    clicksPerSearch: k?.clicks_per_search ?? null,
    globalSearchVolume: k?.global_volume ?? null,
    source: "live",
  };
}

/**
 * 複数 KW を順次取得 (Ahrefs は重いので並列度1で)。
 * クォータ消費が激しいので、5件程度の上澄みに絞ってから呼ぶこと。
 */
export async function fetchKeywordMetricsBatch(
  userId: string,
  keywords: string[],
  opts: { country?: string } = {},
): Promise<KeywordMetrics[]> {
  const results: KeywordMetrics[] = [];
  for (const kw of keywords) {
    try {
      const m = await fetchKeywordMetrics(userId, kw, opts);
      results.push(m);
    } catch (e) {
      console.warn(`[ahrefs] fail for "${kw}":`, e);
    }
  }
  return results;
}

/**
 * ドメインの DR (Domain Rating) を取得。被リンクの強さを示す指標。
 * SERP 上位サイトの権威性を判定するのに使う。
 */
export async function fetchDomainRating(
  userId: string,
  domain: string,
): Promise<number | null> {
  if (process.env.AHREFS_USE_MOCK === "true") {
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) | 0;
    return Math.abs(h) % 100;
  }
  const token = await resolveAhrefsToken(userId);
  if (!token) throw new Error("Ahrefs API トークン未設定");
  const params = new URLSearchParams({ target: domain, select: "domain_rating" });
  const res = await fetch(`${BASE}/site-explorer/domain-rating?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Ahrefs DR error: ${res.status}`);
  const data = (await res.json()) as { domain_rating?: number };
  return data.domain_rating ?? null;
}
