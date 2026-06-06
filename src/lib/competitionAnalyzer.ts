// 指定 KW で Google 上位N件を取得し、固定ドメイン分類で SEO 競合度を概算判定する。
//
// 2026-06-03: Brave Search API → DataForSEO Google SERP API に完全移行。
// 2026-06-06: Gemini 五軸評価 (evaluateWithAI) を撤去。評価は今後、客観 API
//   データ (DataForSEO Keyword Data / SERP features / Ahrefs DR) のみで決定論
//   的に算出するアーキテクチャに転換中 (Step 0 = 評価なし状態)。Gemini は
//   KW 候補生成と rationale 文章化に役割を限定する方針。

import { fetchSerpInternal } from "./dataforseo";
import { detectPlatformOccupancy } from "./platformDomain";
import type { Platform } from "./posters/types";

const SCAN_DEPTH = 10;

/**
 * 指定 KW で Google 上位 N件を取得 (DataForSEO 経由)。
 * 旧 Brave Search 用の Pagination インターフェースは廃止 (DataForSEO は1リクエストで取得可)。
 */
async function fetchSearchPage(
  query: string,
): Promise<{ url: string; title: string }[]> {
  const serp = await fetchSerpInternal(query, { depth: SCAN_DEPTH });
  return serp.results.map((it) => ({ url: it.url, title: it.title }));
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
  // === 固定ドメイン分類ベースの評価 (高速・確定的) ===
  // 個人ブログでも上位入りできそうか  ◎ = 易 / △ = 中 / ✕ = 難
  seoDifficulty: "easy" | "medium" | "hard";
  // 個人ブロガーの参入余地スコア (0-100)
  opportunityScore: number;
  // 簡易説明 (UI 表示用)
  rationale: string;
  topUrls: string[]; // 上位5件の URL (UI 確認用)
  // === 各プラットフォームでの占有状況 (カニバライゼーション検出) ===
  // 例: { note: 3, hatena: 1 } = 上位30件に note記事3本 / はてな1本
  // 該当 platform にはすでに競合記事あり → 投稿しても勝ちにくい
  platformOccupancy: Partial<Record<Platform, number>>;
};

// 単一 KW を分析 (intent は将来の SERP feature × intent マッチで使う予定)
export async function analyzeKeyword(
  kw: string,
  _opts: { intent?: string } = {},
): Promise<CompetitionResult> {
  // DataForSEO は1リクエストで指定件数取れるのでループ不要
  const items = await fetchSearchPage(kw);
  const all = items.slice(0, SCAN_DEPTH);

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

  // プラットフォーム別の占有状況 (note/はてな/livedoor 等にすでに記事があるか)
  const platformOccupancy = detectPlatformOccupancy(all.map((r) => r.url));

  return {
    kw,
    totalScanned: all.length,
    buckets,
    seoDifficulty,
    opportunityScore,
    rationale,
    topUrls: all.slice(0, 5).map((r) => r.url),
    platformOccupancy,
  };
}

// 並列度制限しながら複数 KW を一括分析。kws と intents を index で対応させる
export async function analyzeKeywords(
  kws: { kw: string; intent?: string }[],
  opts: { concurrency?: number } = {},
): Promise<CompetitionResult[]> {
  const concurrency = opts.concurrency ?? 3;
  const out: CompetitionResult[] = new Array(kws.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, kws.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= kws.length) return;
        const { kw, intent } = kws[i];
        try {
          out[i] = await analyzeKeyword(kw, { intent });
        } catch (e) {
          // 失敗した KW は medium で記録 (調査続行)
          out[i] = {
            kw,
            totalScanned: 0,
            buckets: { big_ec: 0, big_media: 0, individual_blog: 0, other: 0 },
            seoDifficulty: "medium",
            opportunityScore: 50,
            rationale: `分析失敗: ${e instanceof Error ? e.message : "unknown"}`,
            topUrls: [],
            platformOccupancy: {},
          };
        }
      }
    },
  );
  await Promise.all(workers);
  return out;
}
