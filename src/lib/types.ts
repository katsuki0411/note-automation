export type Idea = {
  title: string;
  hook: string;
  angle: string;
  trend_source?: string;
};

export const THEMES = [
  {
    id: "renraku",
    label: "連絡・予約",
    desc: "保育園/学校の欠席連絡・小児科/歯医者の予約・習い事の振替連絡など、定型のやりとりが繰り返し発生する系の悩み",
  },
  {
    id: "schedule",
    label: "スケジュール・送迎",
    desc: "家族・兄弟の予定統合、送迎ルート、行事の通知、家族カレンダー共有など、複数人の予定調整に関する悩み",
  },
  {
    id: "paperwork",
    label: "プリント・書類",
    desc: "学校/保育園のお便り・連絡帳・PTA連絡・提出書類など、紙やPDFで来る情報を取り回す系の悩み",
  },
  {
    id: "money",
    label: "お金・家計",
    desc: "家計簿・レシート管理・ポイ活・ふるさと納税・教育費の積立など、お金まわりの記録/管理が面倒系の悩み",
  },
  {
    id: "custom",
    label: "カスタム",
    desc: "ユーザーが手動で指定したお題",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export type SearchProviderName = "brave" | "google" | "ai";

export type FeedVoice = {
  quote: string;
  platform: string;
  url?: string;
  context?: string;
  searchProvider?: SearchProviderName;
};

export type ProposalKeywords = {
  primary: string;
  secondary: string[];
  longTail: string[];
};

export type ProposalTarget = {
  persona: string;
  ageRange: string;
  familyStatus: string;
  painIntensity: 1 | 2 | 3 | 4 | 5;
};

export type KeywordIntent = "info" | "how-to" | "comparison" | "trouble";
export type KeywordVolume = "high" | "medium" | "low" | "niche";
export type KeywordCompetition = "high" | "medium" | "low";
export type KeywordStatus = "untargeted" | "targeted" | "covered";

export const SUBCATEGORIES: Record<ThemeId, { id: string; label: string }[]> = {
  renraku: [
    { id: "hoikuen", label: "保育園関連" },
    { id: "gakkou", label: "学校関連" },
    { id: "iryou", label: "医療関連" },
    { id: "naraigoto", label: "習い事関連" },
    { id: "other", label: "その他" },
  ],
  schedule: [
    { id: "family_calendar", label: "家族カレンダー共有" },
    { id: "soumukai", label: "送迎・移動" },
    { id: "gyouji", label: "行事・イベント" },
    { id: "other", label: "その他" },
  ],
  paperwork: [
    { id: "otayori", label: "お便り・連絡帳" },
    { id: "pta", label: "PTA・保護者連絡" },
    { id: "teishutsu", label: "提出書類・申請" },
    { id: "other", label: "その他" },
  ],
  money: [
    { id: "kakeibo", label: "家計簿・支出管理" },
    { id: "receipt", label: "レシート・領収書" },
    { id: "poikatsu", label: "ポイ活・節約" },
    { id: "furusato", label: "ふるさと納税・控除" },
    { id: "other", label: "その他" },
  ],
  custom: [{ id: "other", label: "その他" }],
};

export type Keyword = {
  id: string;
  themeId: ThemeId;
  subcategoryId: string;
  kw: string;
  intent: KeywordIntent;
  vol: KeywordVolume;
  comp: KeywordCompetition;
  priority: number; // 1-100
  memo?: string;
  status: KeywordStatus;
  articleIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type KeywordsState = {
  keywords: Keyword[];
  updatedAt?: string;
};

export type ProposalImpression = {
  monthlySearchVolume: "high" | "medium" | "low" | "niche";
  monthlySearchVolumeNote: string;
  competitionLevel: "high" | "medium" | "low";
  notePotential: "high" | "medium" | "low";
  notePotentialReason: string;
  reachEstimateMonthly: string;
};

export type FeedSourceMode = "scheduled" | "free" | "derivative" | "seasonal";

export type PlatformCategory = "qa" | "forum" | "sns" | "blog" | "news" | "other";

export const PLATFORM_CATEGORY_META: Record<PlatformCategory, { label: string; color: string }> = {
  qa: { label: "Q&A・相談サイト", color: "#dff1ff" },
  forum: { label: "主婦掲示板", color: "#ffe1ec" },
  sns: { label: "SNS", color: "#e7e9ec" },
  blog: { label: "ブログ・体験記", color: "#fff3d6" },
  news: { label: "メディア・ニュース", color: "#f3e5ff" },
  other: { label: "その他", color: "#eef0f3" },
};

export type Platform = {
  id: string;
  domain: string;
  label: string;
  category: PlatformCategory;
  enabled: boolean;
  isDefault?: boolean;
  memo?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformsState = {
  platforms: Platform[];
  updatedAt?: string;
};

export type FeedIdea = Idea & {
  id: string;
  source: "gemini" | "perplexity";
  themeId: ThemeId;
  customLabel?: string;
  sourceMode?: FeedSourceMode;
  createdAt: string;
  voice?: FeedVoice;
  toolConcept?: string;
  keywords?: ProposalKeywords;
  target?: ProposalTarget;
  impression?: ProposalImpression;
  priorityScore?: number;
  targetKeywordId?: string;
};

export type FeedState = {
  ideas: FeedIdea[];
  lastTickAt?: string;
  tickCount: number;
};

// フェーズ3の「③画像生成指示」ブロックを構造化したもの (migration 0020)。
// 本文中の [IMG-NN｜説明] マーカー1個に対応する。marker は "IMG-00" 形式 (角括弧なし)。
export type ImageSpec = {
  marker: string; // "IMG-00" (角括弧・全角パイプなしに正規化)
  role?: string;
  placement?: string; // アイキャッチ / セクション見出し下 等
  purpose?: string;
  type?: string; // 写真 / イラスト / 図解 / インフォグラフィック / 比較ビジュアル
  aspectRatio?: string; // "1.91:1" / "16:9" 等 (生成時に対応値へ丸める)
  style?: string;
  textInImage?: string;
  prompt: string; // 日本語の詳細生成プロンプト
  negative?: string;
  altText?: string; // 本文マーカーの説明 or purpose から
  imageUrl?: string; // 生成・Blob保存済み画像の公開URL (migration 0020 の image_specs 内に保持)
};

export type Article = {
  id: string;
  createdAt: string;
  idea: Idea;
  bestTitle: string;
  titleCandidates: string[];
  bestTitleReason: string;
  bodyMarkdown: string;
  imagePromptSubject: string;
  imageAltText?: string;
  imagePath?: string;
  // 本文中の [IMG-NN] マーカーに対応する画像生成指示の配列 (migration 0020)。
  // 空配列 = 画像指示なし (旧記事・パース不能時)。
  imageSpecs?: ImageSpec[];
  postedAt?: string;
  // どの投稿先 destination 用に生成された記事か。同じKWでもサイトごとに別記事を持てる。
  // 既存記事は note destination にバックフィル済み (migration 0015)。
  destinationId?: string;
};
