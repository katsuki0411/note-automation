// SERP の Top10 ドメインを 4種類に分類する。
// 「お宝スコア」 計算の SERP 個人ブログ含有判定に使われる (treasureScore.ts)。

export type DomainClass = "personal_blog" | "major_media" | "official" | "unknown";

// 確定: 個人ブログプラットフォーム (誰でも無料で開設可能 = 個人が運営)
const PERSONAL_BLOG_DOMAINS: ReadonlyArray<string | RegExp> = [
  "note.com",
  /\.hatenablog\.(com|jp)$/,
  /\.hateblo\.jp$/,
  "ameblo.jp",
  /\.livedoor\.blog$/,
  /\.blog\.livedoor\.jp$/,
  /\.fc2\.com$/,
  /\.blog\.fc2\.com$/,
  /\.blogspot\.com$/,
  /\.wordpress\.com$/,
  /\.wixsite\.com$/,
  /\.jimdofree\.com$/,
  /\.seesaa\.net$/,
  /\.blog\.seesaa\.jp$/,
  /\.goo\.ne\.jp\/blog/,
  "qiita.com",
  "zenn.dev",
  "stand.fm",
  "medium.com",
  "substack.com",
  /\.tumblr\.com$/,
  "muragon.com",
];

// 確定: 大手メディア / ECモール / 公式コーポレートサイト
// (個人ブログでは勝てない巨大ドメイン)
const MAJOR_MEDIA_DOMAINS: ReadonlyArray<string | RegExp> = [
  // 大手比較・ランキング
  "mybest.com",
  "kakaku.com",
  "monoreco.ameba.jp",
  "macaro-ni.jp",
  "nicoly.jp",
  "all-about.co.jp",
  "allabout.co.jp",
  // EC モール
  "amazon.co.jp",
  "amazon.com",
  "rakuten.co.jp",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
  "paypaymall.yahoo.co.jp",
  "qoo10.jp",
  // 大手メディア
  "yahoo.co.jp",
  "msn.com",
  "wantedly.com",
  "lifehacker.jp",
  "gigazine.net",
  "itmedia.co.jp",
  "impress.co.jp",
  "mynavi.jp",
  "biglobe.ne.jp",
  // 主婦・ベビー系大手
  "co-mam.com",
  "babycome.ne.jp",
  "baby-calendar.jp",
  "moomii.jp",
  "cozre.jp",
  "kosodatemap.gakken.jp",
  // 美容系大手
  "cosme.net",
  "lipscosme.com",
  "atcosme.net",
  // 健康・医療系大手
  "doctor-search.tv",
  "askdoctors.jp",
  "medical.jiji.com",
  // ニュース
  /\.nhk\.or\.jp$/,
  /\.asahi\.com$/,
  /\.mainichi\.jp$/,
  /\.nikkei\.com$/,
  /\.sankei\.com$/,
  // 政府・公共
  /\.go\.jp$/,
  /\.lg\.jp$/,
];

function normalizeHost(urlOrHost: string): string | null {
  try {
    // URL 形式 (http/https) なら parse、それ以外はホスト名扱い
    const lower = urlOrHost.trim().toLowerCase();
    if (!lower) return null;
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      const u = new URL(lower);
      return u.hostname.replace(/^www\./, "");
    }
    // ホスト名と仮定
    return lower.replace(/^www\./, "").replace(/^https?:\/\//, "");
  } catch {
    return null;
  }
}

function matchPatterns(host: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === "string") {
      if (host === p || host.endsWith(`.${p}`)) return true;
    } else if (p.test(host)) {
      return true;
    }
  }
  return false;
}

// subject (商品名) からブランドトークンを抜き出し、ドメインに含まれていれば official 判定。
// 例: subject="ピジョン 母乳実感" / host="pigeon.co.jp" → official
function isOfficialOfSubject(host: string, subject: string): boolean {
  const tokens = subject
    .toLowerCase()
    .split(/[\s　・/]+/)
    .map((t) => t.replace(/[^a-z0-9ぁ-んァ-ヶ一-龥]/g, ""))
    .filter((t) => t.length >= 2);
  // ASCII (英数) のトークンだけドメイン照合に使う
  for (const t of tokens) {
    if (!/^[a-z0-9]+$/.test(t)) continue;
    if (host.includes(t)) return true;
  }
  return false;
}

export function classifyDomain(
  urlOrHost: string,
  subject: string = "",
): DomainClass {
  const host = normalizeHost(urlOrHost);
  if (!host) return "unknown";

  if (matchPatterns(host, PERSONAL_BLOG_DOMAINS)) return "personal_blog";
  if (matchPatterns(host, MAJOR_MEDIA_DOMAINS)) return "major_media";
  if (subject && isOfficialOfSubject(host, subject)) return "official";

  // それ以外 (独自ドメインで知名度判定できないもの) は unknown 扱い。
  // unknown はお宝スコアの SERP 加点では「個人ブログとして数えない」 が保守的なデフォルト。
  return "unknown";
}

// Top10 ドメインのうち、個人ブログとして確定できた件数を返す。
// お宝スコアの「SERP 個人ブログ含有」 軸で使われる。
export function countPersonalBlogsInSerp(
  urls: string[],
  subject: string = "",
): number {
  let count = 0;
  for (const url of urls) {
    if (classifyDomain(url, subject) === "personal_blog") count++;
  }
  return count;
}

// AI Overview 引用元の中に個人サイト (個人ブログ or unknown 独自ドメイン) が含まれているか。
// LLMO シグナルとして treasureScore のボーナス加点に使う。
export function hasPersonalSiteInAiOverview(
  aiOverviewUrls: string[],
  subject: string = "",
): boolean {
  for (const url of aiOverviewUrls) {
    const cls = classifyDomain(url, subject);
    if (cls === "personal_blog") return true;
    // unknown も「個人サイト寄り」 として救済 (大手や公式と判定されない独自ドメイン)
    if (cls === "unknown") return true;
  }
  return false;
}
