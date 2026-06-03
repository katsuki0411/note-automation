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
