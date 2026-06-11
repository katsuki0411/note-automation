import "server-only";
import { resolveDataForSeoCredentials } from "./integrations";

// =========================================================
// DataForSEO SERP API クライアント
// =========================================================
// MultiPostAI の商品スカウト「広く取る」段で使う。 Google SERP を $0.0006/query
// で大量取得できる。Basic 認証 (login + password)。
//
// Mock モード: env DATAFORSEO_USE_MOCK=true で固定レスポンスを返す
// (契約前の UI 動作確認用)。デフォルトは実 API。
// =========================================================

const BASE = "https://api.dataforseo.com/v3";

export type SerpResult = {
  url: string;
  title: string;
  description?: string;
  rank: number;
};

export type SerpResponse = {
  kw: string;
  results: SerpResult[];
  source: "live" | "mock";
};

function authHeader(login: string, password: string): string {
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Mock 用: 適当な SERP データを返す (URL/タイトルだけ)
 */
function mockSerp(kw: string): SerpResponse {
  const slug = encodeURIComponent(kw.replace(/\s+/g, "-"));
  const mockHosts = [
    "kakaku.com",
    "my-best.com",
    "amazon.co.jp",
    "rakuten.co.jp",
    "note.com",
    "ameblo.jp",
    "hatenablog.com",
    "livedoor.blog",
    "blog.fc2.com",
    "youtube.com",
  ];
  return {
    kw,
    results: mockHosts.map((host, i) => ({
      url: `https://${host}/mock-${slug}/${i + 1}`,
      title: `[MOCK] ${kw} - ${host} ${i + 1}件目`,
      description: `Mock データ。実 API 接続後に置き換わります。`,
      rank: i + 1,
    })),
    source: "mock",
  };
}

/**
 * env からのみ認証情報を取得する内部関数 (lib 内部での呼び出し用、userId 不要)
 */
function envCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (login && password) return { login, password };
  return null;
}

/**
 * 内部呼出用 SERP 取得 (userId 不要、env のみ参照)。
 * competitionAnalyzer / seoRank などの lib から呼ぶ用。
 * Brave Search API を完全置換した。
 */
export async function fetchSerpInternal(
  kw: string,
  opts: { depth?: number; locationCode?: number; languageCode?: string } = {},
): Promise<SerpResponse> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockSerp(kw);
  }
  const creds = envCredentials();
  if (!creds) {
    throw new Error(
      "DataForSEO 認証情報が未設定 (env: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)",
    );
  }
  return fetchSerpWithCreds(creds, kw, opts);
}

/**
 * 1つの KW で Google 上位N件を取得 (Live モード: リアルタイム結果、$0.002/query)
 * 結果は最大 10件。location は日本 (2392)、言語は日本語。
 * userId 経由で user_integrations から認証情報を取得 → env フォールバック
 */
export async function fetchSerpLive(
  userId: string,
  kw: string,
  opts: { depth?: number; locationCode?: number; languageCode?: string } = {},
): Promise<SerpResponse> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockSerp(kw);
  }

  const creds = await resolveDataForSeoCredentials(userId);
  if (!creds) {
    throw new Error("DataForSEO 認証情報が未設定。設定→API連携 で登録してください");
  }
  return fetchSerpWithCreds(creds, kw, opts);
}

/**
 * 実際の API 呼出 (credentials を引数で受け取る共通関数)
 */
async function fetchSerpWithCreds(
  creds: { login: string; password: string },
  kw: string,
  opts: { depth?: number; locationCode?: number; languageCode?: string } = {},
): Promise<SerpResponse> {

  const body = [
    {
      keyword: kw,
      location_code: opts.locationCode ?? 2392, // Japan
      language_code: opts.languageCode ?? "ja",
      device: "desktop",
      depth: opts.depth ?? 10,
    },
  ];

  const res = await fetch(`${BASE}/serp/google/organic/live/regular`, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds.login, creds.password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          type?: string;
          url?: string;
          title?: string;
          description?: string;
          rank_absolute?: number;
        }>;
      }>;
    }>;
  };

  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  // organic 結果だけ抽出 (Featured Snippet / AI Overview 等は除外)
  const results: SerpResult[] = items
    .filter((it) => it.type === "organic" && it.url)
    .map((it) => ({
      url: it.url!,
      title: it.title ?? "",
      description: it.description,
      rank: it.rank_absolute ?? 0,
    }))
    .slice(0, opts.depth ?? 10);

  return { kw, results, source: "live" };
}

/**
 * 複数 KW を並列で取得 (concurrency 制限あり)。
 * DataForSEO は1秒2,000 req まで OK なので並列度高くて問題なし。
 */
export async function fetchSerpBatch(
  userId: string,
  keywords: string[],
  opts: { concurrency?: number; depth?: number } = {},
): Promise<SerpResponse[]> {
  const concurrency = opts.concurrency ?? 5;
  const results: SerpResponse[] = [];
  for (let i = 0; i < keywords.length; i += concurrency) {
    const chunk = keywords.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((kw) =>
        fetchSerpLive(userId, kw, { depth: opts.depth }).catch((e) => {
          console.warn(`[dataforseo] fail for "${kw}":`, e);
          return { kw, results: [], source: "live" as const };
        }),
      ),
    );
    results.push(...chunkResults);
  }
  return results;
}

// =========================================================
// DataForSEO Labs API クライアント拡張 (P1 / 2026-06-07)
// 拡張プラン B' (Gemini×4 + DFS×4) で使う3エンドポイント追加:
//   1. Bulk Keyword Difficulty Live    — 100KW一発で KD のみ取得 (¥1.7/100KW)
//   2. Keyword Overview Live           — SV/CPC/KD/Intent/Trend/serp_info/avg_backlinks
//   3. SERP Organic Live Advanced      — PAA/KP/AI Overview/Featured Snippet/Shopping
// =========================================================

const LOCATION_JP = 2392;
const LANGUAGE_JP = "ja";

/** 1KW の KD のみ (Bulk 用) */
export type BulkKdItem = { kw: string; kd: number | null };

/** Keyword Overview の正規化済み出力 */
export type KeywordOverviewItem = {
  kw: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;        // 0.0 - 1.0
  competitionLevel: string | null;   // LOW / MEDIUM / HIGH
  keywordDifficulty: number | null;  // 0-100
  searchIntent: string | null;       // informational/navigational/commercial/transactional
  // 月次SV履歴 (季節性判定用)
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }>;
  // 上位ページの平均被リンク (主リンク)
  avgBacklinksMain: number | null;
  avgBacklinksReferringDomains: number | null;
  // SERP に出る要素タイプ (intent合致判定用)
  serpItemTypes: string[];
};

/** SERP Advanced の 1 item (organic/feature 含む生型) */
export type SerpAdvancedItem = {
  type: string;
  rank?: number;
  url?: string;
  title?: string;
  description?: string;
  raw: Record<string, unknown>;
};

/** AI Overview の引用元 (LLMO 評価用) */
export type AiOverviewReference = {
  url: string;
  title?: string;
  domain?: string;
  source?: string;
};

/** SERP Advanced の正規化済み出力 (機械判定用に features 集約) */
export type SerpAdvancedResponse = {
  kw: string;
  items: SerpAdvancedItem[];
  features: {
    hasAiOverview: boolean;
    hasFeaturedSnippet: boolean;
    hasKnowledgePanel: boolean;
    hasPaa: boolean;
    hasShopping: boolean;
    hasTopStories: boolean;
    hasVideo: boolean;
    hasImage: boolean;
  };
  aiOverviewReferences: AiOverviewReference[];
  paaQuestions: string[];
  source: "live" | "mock";
};

// ---------- Mock ----------

function mockBulkKd(kws: string[]): BulkKdItem[] {
  return kws.map((kw) => {
    let h = 0;
    for (let i = 0; i < kw.length; i++) h = (h * 31 + kw.charCodeAt(i)) | 0;
    return { kw, kd: Math.abs(h) % 80 }; // 0-79
  });
}

function mockKeywordOverview(kws: string[]): KeywordOverviewItem[] {
  return kws.map((kw) => {
    let h = 0;
    for (let i = 0; i < kw.length; i++) h = (h * 31 + kw.charCodeAt(i)) | 0;
    h = Math.abs(h);
    const sv = 100 + (h % 50) * 200;
    const monthly: Array<{ year: number; month: number; searchVolume: number }> = [];
    const now = new Date();
    for (let m = 0; m < 12; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      monthly.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        searchVolume: Math.round(sv * (0.7 + ((h >> m) % 60) / 100)),
      });
    }
    return {
      kw,
      searchVolume: sv,
      cpc: ((h >> 4) % 200) / 10,
      competition: ((h >> 2) % 100) / 100,
      competitionLevel: (["LOW", "MEDIUM", "HIGH"] as const)[h % 3],
      keywordDifficulty: h % 80,
      searchIntent: (["informational", "commercial", "transactional"] as const)[h % 3],
      monthlySearches: monthly,
      avgBacklinksMain: (h >> 6) % 1000,
      avgBacklinksReferringDomains: (h >> 8) % 500,
      serpItemTypes: ["organic", "people_also_ask"],
    };
  });
}

function mockSerpAdvanced(kw: string): SerpAdvancedResponse {
  const basic = mockSerp(kw);
  return {
    kw,
    items: basic.results.map((r) => ({
      type: "organic",
      rank: r.rank,
      url: r.url,
      title: r.title,
      description: r.description,
      raw: r as unknown as Record<string, unknown>,
    })),
    features: {
      hasAiOverview: false,
      hasFeaturedSnippet: false,
      hasKnowledgePanel: false,
      hasPaa: true,
      hasShopping: false,
      hasTopStories: false,
      hasVideo: false,
      hasImage: false,
    },
    aiOverviewReferences: [],
    paaQuestions: [`${kw} とは`, `${kw} の使い方`, `${kw} の選び方`],
    source: "mock",
  };
}

// ---------- Live API ----------

/**
 * Bulk Keyword Difficulty Live — 100KWまで一発で KD のみ取得。
 * 用途: スカウト初期段で大量KWを安価にスクリーニング ($0.011/100KW)。
 */
export async function bulkKeywordDifficulty(
  kws: string[],
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<BulkKdItem[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockBulkKd(kws);
  }
  const creds = envCredentials();
  if (!creds) {
    throw new Error("DataForSEO 認証情報が未設定 (env)");
  }
  const body = [
    {
      keywords: kws,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/bulk_keyword_difficulty/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Bulk KD error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{ keyword?: string; keyword_difficulty?: number | null }>;
      }>;
    }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((it) => ({
    kw: it.keyword ?? "",
    kd: typeof it.keyword_difficulty === "number" ? it.keyword_difficulty : null,
  }));
}

/**
 * Keyword Overview Live — 1KW あたり SV/CPC/KD/Intent/Trend/serp_info/avg_backlinks
 * を一発取得。最大1000KW/req ($0.0101/KW)。
 */
export async function keywordOverview(
  kws: string[],
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<KeywordOverviewItem[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockKeywordOverview(kws);
  }
  const creds = envCredentials();
  if (!creds) {
    throw new Error("DataForSEO 認証情報が未設定 (env)");
  }
  const body = [
    {
      keywords: kws,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
      include_serp_info: true,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/keyword_overview/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Keyword Overview error: ${res.status} ${await res.text()}`);
  }
  type Raw = {
    keyword?: string;
    keyword_info?: {
      search_volume?: number | null;
      cpc?: number | null;
      competition?: number | null;
      competition_level?: string | null;
      monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
    };
    keyword_properties?: { keyword_difficulty?: number | null };
    search_intent_info?: { main_intent?: string | null };
    avg_backlinks_info?: {
      backlinks?: number | null;
      referring_domains?: number | null;
    };
    serp_info?: { item_types?: string[] };
  };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ items?: Raw[] }> }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((it) => ({
    kw: it.keyword ?? "",
    searchVolume: it.keyword_info?.search_volume ?? null,
    cpc: it.keyword_info?.cpc ?? null,
    competition: it.keyword_info?.competition ?? null,
    competitionLevel: it.keyword_info?.competition_level ?? null,
    keywordDifficulty: it.keyword_properties?.keyword_difficulty ?? null,
    searchIntent: it.search_intent_info?.main_intent ?? null,
    monthlySearches: (it.keyword_info?.monthly_searches ?? []).map((m) => ({
      year: m.year,
      month: m.month,
      searchVolume: m.search_volume,
    })),
    avgBacklinksMain: it.avg_backlinks_info?.backlinks ?? null,
    avgBacklinksReferringDomains: it.avg_backlinks_info?.referring_domains ?? null,
    serpItemTypes: it.serp_info?.item_types ?? [],
  }));
}

/**
 * Related Keywords Live — Google の「People also search for」由来の関連 KW。
 * subject 1 つに対して最大 100 件取得可能。$0.011/req 程度。
 * Stage 0 でシード KW として Gemini #1 に渡す用途。
 */
export async function relatedKeywords(
  seed: string,
  opts: { locationCode?: number; languageCode?: string; depth?: number; limit?: number } = {},
): Promise<string[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") return [];
  const creds = envCredentials();
  if (!creds) throw new Error("DataForSEO 認証情報が未設定 (env)");
  const body = [
    {
      keyword: seed,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
      depth: opts.depth ?? 1,
      limit: opts.limit ?? 50,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/related_keywords/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Related Keywords error: ${res.status} ${await res.text()}`);
  }
  type Raw = { keyword_data?: { keyword?: string } };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ items?: Raw[] | null }> | null }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((i) => i.keyword_data?.keyword ?? "").filter(Boolean);
}

/**
 * Keyword Suggestions Live — Google サジェスト由来の関連 KW (検索バー候補)。
 * 実際の検索者が入力するパターン。$0.012/req 程度。
 */
export async function keywordSuggestions(
  seed: string,
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {},
): Promise<string[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") return [];
  const creds = envCredentials();
  if (!creds) throw new Error("DataForSEO 認証情報が未設定 (env)");
  const body = [
    {
      keyword: seed,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
      limit: opts.limit ?? 50,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/keyword_suggestions/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Keyword Suggestions error: ${res.status} ${await res.text()}`);
  }
  type Raw = { keyword?: string };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ items?: Raw[] | null }> | null }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((i) => i.keyword ?? "").filter(Boolean);
}

/**
 * Google Ads Search Volume Bulk — 100KW 単位で SV/CPC/competition を一括取得。
 * Keyword Overview Live が 1KW しか返さないため、Stage 2 の bulk 取得用に使う。
 * $0.075 / 100 keywords (Keyword Overview の 13倍安い)。
 * keyword_difficulty / search_intent_info は取れないので null を返す
 * (KD は Backlinks 契約後に Keyword Overview で別途取得する想定)。
 */
export async function searchVolumeBulk(
  kws: string[],
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<KeywordOverviewItem[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockKeywordOverview(kws);
  }
  const creds = envCredentials();
  if (!creds) {
    throw new Error("DataForSEO 認証情報が未設定 (env)");
  }
  const body = [
    {
      keywords: kws,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
    },
  ];
  const res = await fetch(
    `${BASE}/keywords_data/google_ads/search_volume/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Search Volume error: ${res.status} ${await res.text()}`);
  }
  type Raw = {
    keyword?: string;
    search_volume?: number | null;
    cpc?: number | null;
    competition?: string | null;        // "HIGH" / "MEDIUM" / "LOW"
    competition_index?: number | null;  // 0-100
    monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
  };
  // ★ 重要: Search Volume API は items ではなく result 直下に各 KW が並ぶ
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Raw[] | null }>;
  };
  const items = data.tasks?.[0]?.result ?? [];
  return items.map((it) => ({
    kw: it.keyword ?? "",
    searchVolume: it.search_volume ?? null,
    cpc: it.cpc ?? null,
    // competition_index (0-100) を 0-1 にスケール
    competition:
      typeof it.competition_index === "number" ? it.competition_index / 100 : null,
    competitionLevel: it.competition ?? null,
    keywordDifficulty: null, // Search Volume API では取得不可
    searchIntent: null,      // Search Volume API では取得不可
    monthlySearches: (it.monthly_searches ?? []).map((m) => ({
      year: m.year,
      month: m.month,
      searchVolume: m.search_volume,
    })),
    avgBacklinksMain: null,
    avgBacklinksReferringDomains: null,
    serpItemTypes: [],
  }));
}

/**
 * Search Intent Bulk — Google が学習した検索意図を実データから取得。
 * 100KW までまとめて投げて約 $0.043 (¥6.5)、コスパ最強。
 * 4 ラベル (commercial / informational / navigational / transactional) を返す。
 * Gemini の intent 推定の代替/補強用。
 */
export type SearchIntentItem = {
  kw: string;
  intent: string | null; // commercial / informational / navigational / transactional / null
  probability: number | null;
};

export async function searchIntentBulk(
  kws: string[],
  opts: { languageCode?: string } = {},
): Promise<SearchIntentItem[]> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return kws.map((kw) => ({ kw, intent: "informational", probability: 0.5 }));
  }
  const creds = envCredentials();
  if (!creds) throw new Error("DataForSEO 認証情報が未設定 (env)");
  const body = [
    {
      keywords: kws,
      language_code: opts.languageCode ?? LANGUAGE_JP,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/search_intent/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Search Intent error: ${res.status} ${await res.text()}`);
  }
  type Raw = {
    keyword?: string;
    keyword_intent?: { label?: string; probability?: number } | null;
  };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ items?: Raw[] | null }> | null }>;
  };
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.map((it) => ({
    kw: it.keyword ?? "",
    intent: it.keyword_intent?.label ?? null,
    probability: it.keyword_intent?.probability ?? null,
  }));
}

/**
 * On-Page Content Parsing — 単一 URL の HTML を構造化して返す。
 * H1/H2/H3 タイトル、メタ情報、本文文字数が取れる。$0.000125/req と激安。
 * 採用候補の SERP Top3 サイトに対して叩いて Stage 5 Gemini #3 + 記事生成に活用。
 */
export type ContentStructure = {
  url: string;
  domain: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number | null;
};

export async function contentParsing(url: string): Promise<ContentStructure | null> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return {
      url,
      domain: new URL(url).hostname.replace(/^www\./, ""),
      title: "Mock",
      metaDescription: null,
      h1: [],
      h2: [],
      h3: [],
      wordCount: null,
    };
  }
  const creds = envCredentials();
  if (!creds) throw new Error("DataForSEO 認証情報が未設定 (env)");
  const body = [{ url }];
  const res = await fetch(
    `${BASE}/on_page/content_parsing/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`DataForSEO Content Parsing error: ${res.status} ${await res.text()}`);
  }
  type RawHeader = { text?: string | null };
  type RawItem = {
    page_content?: {
      header?: { primary_header?: string | null };
      main_topic?: Array<{ h_title?: string | null; primary_topic?: string | null }>;
    };
    page_as_markdown?: string | null;
    meta?: {
      title?: string | null;
      description?: string | null;
      htags?: {
        h1?: RawHeader[] | string[];
        h2?: RawHeader[] | string[];
        h3?: RawHeader[] | string[];
      };
      content?: {
        plain_text_word_count?: number | null;
      };
    };
  };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: RawItem[] | null }>;
  };
  const item = data.tasks?.[0]?.result?.[0];
  if (!item) return null;
  const normHeaders = (arr: RawHeader[] | string[] | undefined): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((h) => (typeof h === "string" ? h : h?.text ?? ""))
      .filter((s) => s.trim().length > 0);
  };
  return {
    url,
    domain: (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })(),
    title: item.meta?.title ?? null,
    metaDescription: item.meta?.description ?? null,
    h1: normHeaders(item.meta?.htags?.h1),
    h2: normHeaders(item.meta?.htags?.h2),
    h3: normHeaders(item.meta?.htags?.h3),
    wordCount: item.meta?.content?.plain_text_word_count ?? null,
  };
}

/**
 * SERP Organic Live Advanced — 上位N件 + 全 SERP feature。
 * AI Overview 含む。$0.002/req (+ AI Overview tracking で +$0.0006/req)。
 */
export async function fetchSerpAdvanced(
  kw: string,
  opts: {
    depth?: number;
    locationCode?: number;
    languageCode?: string;
    includeAiOverview?: boolean;
  } = {},
): Promise<SerpAdvancedResponse> {
  if (process.env.DATAFORSEO_USE_MOCK === "true") {
    return mockSerpAdvanced(kw);
  }
  const creds = envCredentials();
  if (!creds) {
    throw new Error("DataForSEO 認証情報が未設定 (env)");
  }
  const body = [
    {
      keyword: kw,
      location_code: opts.locationCode ?? LOCATION_JP,
      language_code: opts.languageCode ?? LANGUAGE_JP,
      device: "desktop",
      depth: opts.depth ?? 10,
      // AI Overview と PAA を確実に拾う
      people_also_ask_click_depth: 2,
      load_async_ai_overview: opts.includeAiOverview ?? true,
    },
  ];
  const res = await fetch(`${BASE}/serp/google/organic/live/advanced`, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds.login, creds.password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO SERP Advanced error: ${res.status} ${await res.text()}`);
  }
  type RawItem = {
    type?: string;
    rank_absolute?: number;
    url?: string;
    title?: string;
    description?: string;
    items?: unknown[];           // ai_overview の references / paa の expanded など
    references?: Array<{ url?: string; title?: string; domain?: string; source?: string }>;
    [k: string]: unknown;
  };
  const data = (await res.json()) as {
    tasks?: Array<{ result?: Array<{ items?: RawItem[] }> }>;
  };
  const rawItems: RawItem[] = data.tasks?.[0]?.result?.[0]?.items ?? [];

  const items: SerpAdvancedItem[] = rawItems.map((it) => ({
    type: it.type ?? "unknown",
    rank: it.rank_absolute,
    url: it.url,
    title: it.title,
    description: it.description,
    raw: it as Record<string, unknown>,
  }));

  // feature 集計
  const hasType = (t: string) => items.some((i) => i.type === t);
  const features = {
    hasAiOverview: hasType("ai_overview"),
    hasFeaturedSnippet: hasType("featured_snippet"),
    hasKnowledgePanel: hasType("knowledge_graph") || hasType("knowledge_panel"),
    hasPaa: hasType("people_also_ask"),
    hasShopping: hasType("shopping") || hasType("popular_products"),
    hasTopStories: hasType("top_stories"),
    hasVideo: hasType("video"),
    hasImage: hasType("images"),
  };

  // AI Overview の references を抽出
  const aiOverviewItem = rawItems.find((it) => it.type === "ai_overview");
  const aiOverviewReferences: AiOverviewReference[] = [];
  if (aiOverviewItem?.references && Array.isArray(aiOverviewItem.references)) {
    for (const r of aiOverviewItem.references) {
      if (r.url) {
        aiOverviewReferences.push({
          url: r.url,
          title: r.title,
          domain: r.domain,
          source: r.source,
        });
      }
    }
  }

  // PAA 質問抽出
  const paaItem = rawItems.find((it) => it.type === "people_also_ask");
  const paaQuestions: string[] = [];
  if (paaItem?.items && Array.isArray(paaItem.items)) {
    for (const q of paaItem.items as Array<{ title?: string }>) {
      if (q.title) paaQuestions.push(q.title);
    }
  }

  return {
    kw,
    items,
    features,
    aiOverviewReferences,
    paaQuestions,
    source: "live",
  };
}
