// 指定 KW で Brave 上位30件を取得し、上位ドメインの分布から SEO 難易度を判定する。
// seoRank.ts と Brave Search 呼び出しは同じだが、用途が違うため別関数として持つ。

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SCAN_DEPTH = 30;
const PAGE_SIZE = 20;

type BraveItem = { url?: string; title?: string };
type BraveResponse = { web?: { results?: BraveItem[] } };

async function fetchSearchPage(
  query: string,
  pageOffset: number,
): Promise<{ url: string; title: string }[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY が未設定です");
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(PAGE_SIZE));
  url.searchParams.set("offset", String(pageOffset));
  url.searchParams.set("country", "JP");
  url.searchParams.set("search_lang", "jp");
  url.searchParams.set("ui_lang", "ja-JP");
  url.searchParams.set("safesearch", "off");

  const res = await fetch(url.toString(), {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Brave Search error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as BraveResponse;
  return (data.web?.results ?? [])
    .map((it) => ({ url: it.url ?? "", title: it.title ?? "" }))
    .filter((r) => r.url);
}

// 上位ドメインの分類
export type DomainCategory = "big_ec" | "big_media" | "individual_blog" | "other";

const BIG_EC = [
  "amazon.co.jp",
  "amazon.com",
  "rakuten.co.jp",
  "rakuten.com",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
  "paypaymall.yahoo.co.jp",
  "mercari.com",
  "qoo10.jp",
  "askul.co.jp",
  "lohaco.jp",
  "biccamera.com",
  "yodobashi.com",
];

const BIG_MEDIA = [
  "kakaku.com",
  "my-best.com",
  "mybest.tokyo",
  "mybest.com",
  "monomag.jp",
  "mono-tv.com",
  "the360.life",
  "limia.jp",
  "lifehacker.jp",
  "macotakara.jp",
  "the-best-one.net",
  "trillonmag.com",
  "bestone.life",
  "ranking.goo.ne.jp",
  "fumufumunews.jp",
  "biz-journal.jp",
  "thebest-1.com",
];

const INDIVIDUAL_BLOG_HOSTS = [
  "hatenablog.com",
  "hatenadiary.jp",
  "livedoor.blog",
  "livedoor.jp",
  "blog.livedoor.jp",
  "blog.fc2.com",
  "fc2.com",
  "ameblo.jp",
  "seesaa.net",
  "note.com",
  "blog.jp",
  "blogspot.com",
  "wordpress.com",
  "wpx.jp",
  "naver.jp",
  "exblog.jp",
];

function categorizeDomain(host: string): DomainCategory {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (BIG_EC.some((d) => h === d || h.endsWith(`.${d}`))) return "big_ec";
  if (BIG_MEDIA.some((d) => h === d || h.endsWith(`.${d}`))) return "big_media";
  if (INDIVIDUAL_BLOG_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) {
    return "individual_blog";
  }
  return "other";
}

export type CompetitionBucket = {
  big_ec: number;
  big_media: number;
  individual_blog: number;
  other: number;
};

export type CompetitionResult = {
  kw: string;
  totalScanned: number;
  buckets: CompetitionBucket;
  // 個人ブログでも上位入りできそうか
  // ◎ = 易 / △ = 中 / ✕ = 難
  seoDifficulty: "easy" | "medium" | "hard";
  // 個人ブロガーの参入余地スコア (0-100)
  opportunityScore: number;
  // 簡易説明 (UI 表示用)
  rationale: string;
  topUrls: string[]; // 上位5件の URL (UI 確認用)
};

// 単一 KW を分析
export async function analyzeKeyword(kw: string): Promise<CompetitionResult> {
  const totalPages = Math.ceil(SCAN_DEPTH / PAGE_SIZE);
  const all: { url: string; title: string }[] = [];
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const items = await fetchSearchPage(kw, pageIdx);
    for (const it of items) {
      if (all.length >= SCAN_DEPTH) break;
      all.push(it);
    }
    if (items.length < PAGE_SIZE) break;
  }

  const buckets: CompetitionBucket = {
    big_ec: 0,
    big_media: 0,
    individual_blog: 0,
    other: 0,
  };
  for (const r of all) {
    try {
      const u = new URL(r.url);
      buckets[categorizeDomain(u.hostname)]++;
    } catch {
      buckets.other++;
    }
  }

  const total = Math.max(1, all.length);
  const ecRatio = buckets.big_ec / total;
  const mediaRatio = buckets.big_media / total;
  const blogRatio = buckets.individual_blog / total;

  // 難易度判定ロジック:
  //   大手メディア多い (mybest/kakaku/mono系) → 個人では勝てない → hard
  //   個人ブログばかり → 飽和、新規参入は厳しい → hard
  //   大手 EC が多い (Amazon/楽天が並ぶ) → 隙間あり → easy
  //   ミックス → medium
  let seoDifficulty: CompetitionResult["seoDifficulty"];
  let rationale: string;
  if (mediaRatio >= 0.4) {
    seoDifficulty = "hard";
    rationale = `大手比較メディア (mybest/kakaku 等) が ${Math.round(mediaRatio * 100)}% を占めている`;
  } else if (blogRatio >= 0.5 && mediaRatio < 0.2) {
    seoDifficulty = "hard";
    rationale = `個人ブログ系が ${Math.round(blogRatio * 100)}% で飽和気味`;
  } else if (ecRatio >= 0.4 && mediaRatio < 0.2) {
    seoDifficulty = "easy";
    rationale = `大手EC (Amazon/楽天) が ${Math.round(ecRatio * 100)}% を占め、レビュー記事の余地あり`;
  } else {
    seoDifficulty = "medium";
    rationale = `EC ${Math.round(ecRatio * 100)}% / 比較メディア ${Math.round(mediaRatio * 100)}% / 個人ブログ ${Math.round(blogRatio * 100)}% のミックス`;
  }

  // 機会スコア (0-100): EC多めで個人ブログ少なめが高得点
  const opportunityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        50 + ecRatio * 50 - mediaRatio * 60 - blogRatio * 20,
      ),
    ),
  );

  return {
    kw,
    totalScanned: all.length,
    buckets,
    seoDifficulty,
    opportunityScore,
    rationale,
    topUrls: all.slice(0, 5).map((r) => r.url),
  };
}

// 並列度制限しながら複数 KW を一括分析
export async function analyzeKeywords(
  kws: string[],
  opts: { concurrency?: number } = {},
): Promise<CompetitionResult[]> {
  const concurrency = opts.concurrency ?? 3; // Brave のレート制限を考慮
  const out: CompetitionResult[] = new Array(kws.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, kws.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= kws.length) return;
        try {
          out[i] = await analyzeKeyword(kws[i]);
        } catch (e) {
          // 失敗した KW は medium で記録 (調査続行)
          out[i] = {
            kw: kws[i],
            totalScanned: 0,
            buckets: { big_ec: 0, big_media: 0, individual_blog: 0, other: 0 },
            seoDifficulty: "medium",
            opportunityScore: 50,
            rationale: `分析失敗: ${e instanceof Error ? e.message : "unknown"}`,
            topUrls: [],
          };
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}
