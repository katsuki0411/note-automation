// Amazon ベストセラーページから商品リストをスクレイピングする。
//
// ⚠ 規約注意:
//   Amazon の利用規約はスクレイピングをグレーゾーンとして扱っている。
//   常識的範囲のレート (1リクエスト/秒 程度・1日数回) に抑え、本番運用前に
//   PA-API (Product Advertising API) への切替を強く推奨。アソシエイト ID と
//   30日以内に3件の売上があれば PA-API が使えるようになる。
//
// 取得方式:
//   1. fetch で /gp/bestsellers/<category>/ の HTML を取得 (UAヘッダー偽装)
//   2. /dp/<ASIN> を含むリンクを HTML から全抽出
//   3. 同一ASINを重複排除して TOP_N まで保持
//   4. 商品タイトル / 画像URL は HTML パースで取れる範囲で抽出 (取れなければ空)

export type BestsellerCategory = {
  id: string;
  label: string;
  urlPath: string; // /gp/bestsellers/<urlPath>/
};

export const BESTSELLER_CATEGORIES: BestsellerCategory[] = [
  { id: "electronics", label: "家電 & カメラ", urlPath: "electronics" },
  { id: "kitchen", label: "ホーム & キッチン", urlPath: "kitchen" },
  { id: "beauty", label: "ビューティー", urlPath: "beauty" },
  { id: "books", label: "本", urlPath: "books" },
  { id: "baby", label: "ベビー & マタニティ", urlPath: "baby" },
  { id: "sports", label: "スポーツ & アウトドア", urlPath: "sports" },
  { id: "apparel", label: "服 & ファッション小物", urlPath: "apparel" },
  { id: "food", label: "食品 & 飲料", urlPath: "food-beverage" },
  { id: "pet", label: "ペット用品", urlPath: "pet-supplies" },
  { id: "diy", label: "DIY・工具・ガーデン", urlPath: "diy" },
];

export type BestsellerItem = {
  rank: number;
  asin: string;
  title: string;
  url: string;
  imageUrl?: string;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TOP_N = 10;

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Amazon fetch failed: HTTP ${res.status}`);
  }
  return res.text();
}

// HTML から商品候補を抽出する。
// Amazon ベストセラーページの HTML は複雑だが、商品リンクは必ず /dp/<ASIN> 形式を含む。
// 1. /dp/<ASIN> を出現順に拾う (= ランキング順)
// 2. その近辺の <img> から title alt / src を取って商品名 + 画像URLにする
// regex ベースで完璧ではないが、MVP として動く範囲を狙う。
function parseBestsellers(html: string): BestsellerItem[] {
  const items: BestsellerItem[] = [];
  const seen = new Set<string>();

  // /dp/<ASIN> を含むリンクと、その先頭から数百文字内の <img alt="..."> + <img src="..."> をマッチ
  // ASIN は通常英数字10文字。Amazon は固定長
  const linkRegex = /\/dp\/([A-Z0-9]{10})(?:[/?"#&])/g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const asin = m[1];
    if (seen.has(asin)) continue;
    seen.add(asin);

    // この出現位置の前後500文字以内で <img alt="..." src="..."> を探す
    const start = Math.max(0, m.index - 800);
    const end = Math.min(html.length, m.index + 800);
    const slice = html.slice(start, end);

    // title 取得: img の alt 属性 / aria-label / span 内テキスト
    let title =
      slice.match(/<img[^>]+alt="([^"]{4,300})"/)?.[1] ??
      slice.match(/aria-label="([^"]{4,300})"/)?.[1] ??
      "";
    title = title.trim();
    if (!title) {
      // fallback: 商品リンクの近くにある「商品名らしき」テキストを拾う (短すぎるものは除外)
      const altLike = slice.match(/<span[^>]*>([^<\n]{8,200})<\/span>/)?.[1];
      title = altLike?.trim() ?? "";
    }

    // 画像URL: 同 slice 内の amazon CDN URL
    const imgMatch = slice.match(/https?:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp)/i);
    const imageUrl = imgMatch?.[0];

    items.push({
      rank: items.length + 1,
      asin,
      title: title || `(タイトル取得失敗) ASIN:${asin}`,
      url: `https://www.amazon.co.jp/dp/${asin}/`,
      imageUrl,
    });

    if (items.length >= TOP_N) break;
  }

  return items;
}

// 単一カテゴリのベストセラー TOP10 を取得
export async function fetchBestsellersForCategory(
  category: BestsellerCategory,
): Promise<BestsellerItem[]> {
  const url = `https://www.amazon.co.jp/gp/bestsellers/${category.urlPath}/`;
  const html = await fetchHtml(url);
  return parseBestsellers(html);
}

// 全カテゴリを並列で取得 (Amazon 側のレート制限を考慮して直列気味に)
export async function fetchAllBestsellers(
  opts: { concurrency?: number; categories?: BestsellerCategory[] } = {},
): Promise<{ category: BestsellerCategory; items: BestsellerItem[]; error?: string }[]> {
  const concurrency = opts.concurrency ?? 2;
  const cats = opts.categories ?? BESTSELLER_CATEGORIES;
  const results: { category: BestsellerCategory; items: BestsellerItem[]; error?: string }[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, cats.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= cats.length) return;
      try {
        const items = await fetchBestsellersForCategory(cats[i]);
        results[i] = { category: cats[i], items };
      } catch (e) {
        results[i] = {
          category: cats[i],
          items: [],
          error: e instanceof Error ? e.message : "unknown",
        };
      }
      // レート対策: カテゴリ間に 1秒 ディレイ
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
  await Promise.all(workers);
  return results;
}
