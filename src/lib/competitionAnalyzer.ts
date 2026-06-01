// 指定 KW で Brave 上位N件を取得し、(1) 固定ドメイン分類 と (2) Gemini AI 五軸評価
// の両方で SEO/LLMO 競合度を判定する。
//
// (1) 固定分類は早くて安定だが新興メディアを取りこぼす。
// (2) Gemini 評価は動的でかつ intent との整合性 / LLMO 適性 まで判定するが、
//     ハルシネーションの可能性あり。両方並べて表示し、ユーザーが見比べる設計。
//
// SCAN_DEPTH=10 なら count=10 を1リクエストで取得し、Brave 無料枠 (2,000req/月) で
// 月 250 回程度のスカウト (1 KW = 1 req × 6〜8 KW/回) が可能。

import { gemini, MODELS } from "./gemini";
import { detectPlatformOccupancy } from "./platformDomain";
import type { Platform } from "./posters/types";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SCAN_DEPTH = 10;
// Brave API の1ページ上限 (max 20)。SCAN_DEPTH を増やしてもこのサイズを超えるとページ送り
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
  // SCAN_DEPTH=10 のとき count=10 で1リクエスト完結 (リクエスト数削減のため)
  url.searchParams.set("count", String(Math.min(PAGE_SIZE, SCAN_DEPTH)));
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

// Gemini AI による五軸評価。各 0-100 で「高いほど個人ブログに有利」
export type AIScores = {
  // 上位サイトの権威性が "低い" ほど高得点 (大手メディア/Wikipedia等が多いと低)
  authority: number;
  // SERP が intent を満たせて "いない" ほど高得点 = チャンス
  // (例: 比較intent なのに上位が商品ページばかり = 高)
  intentGap: number;
  // SERP に個人ブログの解説記事が "入る余地" がどれだけあるか
  blogRoom: number;
  // AI 検索 (ChatGPT/Perplexity/Gemini AI Overview) で引用元になりやすいか
  llmoAffinity: number;
  // 動画(YouTube)/SNS が "少ない" ほど高得点 (文字記事に有利)
  mediaMix: number;
  // 加重平均 (overall) = intentGap*0.30 + blogRoom*0.25 + authority*0.20 + llmoAffinity*0.15 + mediaMix*0.10
  overall: number;
  // Gemini が出した日本語の判断理由 (UI に表示)
  rationale: string;
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
  // === Gemini AI 五軸評価 (任意・取得失敗時は undefined) ===
  ai?: AIScores;
};

// Gemini に Brave 上位N件 + intent を渡して五軸評価を取得
// 失敗時は undefined を返す (ハルシネーション/JSON 不正等)
async function evaluateWithAI(
  kw: string,
  intent: string | undefined,
  topResults: { url: string; title: string }[],
): Promise<AIScores | undefined> {
  if (topResults.length === 0) return undefined;
  const topN = topResults.length;
  const prompt = `
あなたは SEO/LLMO の専門家です。以下のキーワードと Brave 上位${topN}件の SERP データから、5つの観点で評価してください。

# 入力
- キーワード: ${kw}
- 検索意図 (intent): ${intent ?? "unknown"}
- 上位${topN}件 (タイトル + URL):
${topResults.map((r, i) => `${i + 1}. ${r.title} | ${r.url}`).join("\n")}

# 評価軸 (各 0-100、高いほど個人ブログに有利)
1. authority: 上位サイトのドメイン権威性が "低い" ほど高得点 (Wikipedia/政府/大手新聞/大手比較メディアが多い = 低、知らないドメイン = 高)
2. intentGap: SERP が intent "${intent ?? "unknown"}" を "満たせていない" ほど高得点 (例: 比較intent なのに上位が商品ページ・SNSばかり = 高 = 隙間チャンス)
3. blogRoom: SERP に個人ブログの解説記事が "入る余地" がどれだけあるか (大手メディア独占 = 低、商品ページ多め = 高)
4. llmoAffinity: AI 検索 (ChatGPT/Perplexity/Gemini AI Overview) で "引用源になりやすい" KW か (情報網羅性・専門解説ニーズが強い = 高)
5. mediaMix: 動画(YouTube)・SNS が "少ない" ほど高得点 (文字記事に有利。動画ばかりだとテキスト記事の天井低い)

# 出力フォーマット (JSON 1個のみ、前後の説明文禁止)
{
  "authority": 70,
  "intentGap": 50,
  "blogRoom": 65,
  "llmoAffinity": 60,
  "mediaMix": 80,
  "rationale": "上位はAmazonと楽天が多く、比較メディアは少ない。intent=comparison のニーズは商品ページでは満たせず、解説記事の余地がある。LLMO は中程度。"
}
`.trim();

  try {
    const ai = gemini();
    const res = await ai.models.generateContent({
      model: MODELS.research,
      contents: prompt,
      config: { temperature: 0.3, maxOutputTokens: 2000 },
    });
    const text = res.text ?? "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return undefined;
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const clamp = (v: unknown, fallback = 50) => {
      const n = typeof v === "number" ? v : Number(v);
      if (!isFinite(n)) return fallback;
      return Math.max(0, Math.min(100, Math.round(n)));
    };
    const authority = clamp(parsed.authority);
    const intentGap = clamp(parsed.intentGap);
    const blogRoom = clamp(parsed.blogRoom);
    const llmoAffinity = clamp(parsed.llmoAffinity);
    const mediaMix = clamp(parsed.mediaMix);
    const overall = Math.round(
      intentGap * 0.30 +
        blogRoom * 0.25 +
        authority * 0.20 +
        llmoAffinity * 0.15 +
        mediaMix * 0.10,
    );
    return {
      authority,
      intentGap,
      blogRoom,
      llmoAffinity,
      mediaMix,
      overall,
      rationale: String(parsed.rationale ?? ""),
    };
  } catch {
    return undefined;
  }
}

// 単一 KW を分析 (intent 任意で渡せる。渡されれば Gemini 五軸評価も実行)
export async function analyzeKeyword(
  kw: string,
  opts: { intent?: string; useAI?: boolean } = {},
): Promise<CompetitionResult> {
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

  // Gemini 五軸評価 (オプション)
  const ai = opts.useAI !== false ? await evaluateWithAI(kw, opts.intent, all) : undefined;

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
    ai,
  };
}

// 並列度制限しながら複数 KW を一括分析。kws と intents を index で対応させる
export async function analyzeKeywords(
  kws: { kw: string; intent?: string }[],
  opts: { concurrency?: number; useAI?: boolean } = {},
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
        const { kw, intent } = kws[i];
        try {
          out[i] = await analyzeKeyword(kw, { intent, useAI: opts.useAI });
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
