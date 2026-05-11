import { gemini, MODELS } from "@/lib/gemini";
import {
  RESEARCH_FEED_PROMPT,
  RESEARCH_DERIVATIVE_PROMPT,
  RESEARCH_FREE_PROMPT,
  RESEARCH_FROM_SEARCH_PROMPT,
} from "@/lib/prompts";
import { appendIdeas, loadFeed, pickNextTheme } from "@/lib/feed";
import { loadArticles } from "@/lib/storage";
import {
  buildSearchQueriesAsync,
  getAllowedPlatformDomains,
  isProviderAvailable,
  multiSearch,
  platformLabelForDomainAsync,
  type SearchResult,
} from "@/lib/searchProviders";
import { THEMES, type FeedIdea, type FeedSourceMode, type ThemeId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 240;

function repairJson(s: string): string {
  return (
    s
      // 末尾カンマ
      .replace(/,(\s*[}\]])/g, "$1")
      // クオート無しキー（雑だが一般的）
      // .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')  // 副作用怖いのでoff
      .trim()
  );
}

function tryRecoverArrayItems(cleaned: string): unknown[] {
  // 配列が壊れていても1要素ずつパースを試みる
  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const piece = cleaned.slice(start, i + 1);
        try {
          items.push(JSON.parse(piece));
        } catch {
          try {
            items.push(JSON.parse(repairJson(piece)));
          } catch {
            // skip
          }
        }
        start = -1;
      }
    }
  }
  return items;
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    // 配列マーカー無くても要素回収を試みる
    const items = tryRecoverArrayItems(cleaned);
    if (items.length > 0) return items;
    throw new Error("JSON配列が見つかりません");
  }
  cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(repairJson(cleaned));
    } catch {
      // 最後の手段: 1要素ずつ救済
      const items = tryRecoverArrayItems(cleaned);
      if (items.length > 0) return items;
      throw new Error("JSON parse失敗（救済も失敗）");
    }
  }
}

const FALLBACK_MODELS = [MODELS.research, "gemini-2.5-flash-lite", "gemini-2.0-flash"];

type GeminiCallOpts = { useGoogleSearch?: boolean };

async function callGemini(prompt: string, opts: GeminiCallOpts = {}): Promise<string> {
  const ai = gemini();
  let lastErr: unknown;
  for (const model of FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            ...(opts.useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
            temperature: 0.85,
            maxOutputTokens: 16000,
          },
        });
        return response.text ?? "";
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /\b(429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(msg);
        if (!transient) throw e;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
    }
  }
  throw lastErr ?? new Error("Gemini呼び出し失敗");
}

type RawProposal = {
  voice?: { quote?: string; platform?: string; url?: string; context?: string };
  proposal?: {
    title?: string;
    hook?: string;
    angle?: string;
    tool_concept?: string;
    keywords?: { primary?: string; secondary?: string[]; long_tail?: string[] };
    target?: { persona?: string; age_range?: string; family_status?: string; pain_intensity?: number };
    impression?: {
      monthly_search_volume?: string;
      monthly_search_volume_note?: string;
      competition_level?: string;
      note_potential?: string;
      note_potential_reason?: string;
      reach_estimate_monthly?: string;
    };
    priority_score?: number;
  };
};

function transformProposals(
  raw: RawProposal[],
  ctx: {
    themeId: ThemeId;
    customLabel?: string;
    sourceMode: FeedSourceMode;
    providerByUrl?: Map<string, "brave" | "google">;
    defaultProvider?: "brave" | "google" | "ai";
  },
): Omit<FeedIdea, "id" | "createdAt">[] {
  const BANNED_PLATFORM = /^(web|ウェブ|ウェブメディア|webメディア|メディア|ニュース|news|個人ブログ|ブログ|blog|サイト|記事|オウンドメディア|プレスリリース)\s*$/i;
  return raw
    .filter((r) => r?.proposal?.title && r?.voice?.quote && r?.proposal?.tool_concept)
    .filter((r) => !BANNED_PLATFORM.test(String(r.voice?.platform ?? "").trim()))
    .map((r) => {
      const platform = r.voice!.platform ?? "Yahoo!知恵袋";
      const kw = r.proposal?.keywords;
      const tg = r.proposal?.target;
      const imp = r.proposal?.impression;
      const allowedVolume = ["high", "medium", "low", "niche"] as const;
      const allowedLevel = ["high", "medium", "low"] as const;
      const clampVol = (v?: string) =>
        (allowedVolume as readonly string[]).includes(String(v))
          ? (v as (typeof allowedVolume)[number])
          : "medium";
      const clampLvl = (v?: string) =>
        (allowedLevel as readonly string[]).includes(String(v))
          ? (v as (typeof allowedLevel)[number])
          : "medium";
      const voiceUrl = r.voice!.url || undefined;
      const lookedUpProvider = voiceUrl
        ? ctx.providerByUrl?.get(normalizeForLookup(voiceUrl))
        : undefined;
      const finalProvider = lookedUpProvider ?? ctx.defaultProvider ?? "ai";
      return {
        title: r.proposal!.title!,
        hook: r.proposal?.hook ?? "",
        angle: r.proposal?.angle ?? "",
        toolConcept: r.proposal?.tool_concept ?? "",
        keywords: kw?.primary
          ? { primary: kw.primary, secondary: kw.secondary ?? [], longTail: kw.long_tail ?? [] }
          : undefined,
        target: tg?.persona
          ? {
              persona: tg.persona,
              ageRange: tg.age_range ?? "",
              familyStatus: tg.family_status ?? "",
              painIntensity: (Math.max(1, Math.min(5, tg.pain_intensity ?? 3)) as 1 | 2 | 3 | 4 | 5),
            }
          : undefined,
        impression: imp
          ? {
              monthlySearchVolume: clampVol(imp.monthly_search_volume),
              monthlySearchVolumeNote: imp.monthly_search_volume_note ?? "",
              competitionLevel: clampLvl(imp.competition_level),
              notePotential: clampLvl(imp.note_potential),
              notePotentialReason: imp.note_potential_reason ?? "",
              reachEstimateMonthly: imp.reach_estimate_monthly ?? "",
            }
          : undefined,
        priorityScore:
          typeof r.proposal?.priority_score === "number"
            ? Math.max(1, Math.min(100, Math.round(r.proposal.priority_score)))
            : undefined,
        voice: {
          quote: r.voice!.quote!,
          platform,
          url: voiceUrl,
          context: r.voice!.context || undefined,
          searchProvider: finalProvider,
        },
        source: "gemini" as const,
        themeId: ctx.themeId,
        customLabel: ctx.customLabel,
        sourceMode: ctx.sourceMode,
      };
    });
}

function normalizeForLookup(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/^www\./, "");
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.hostname}${pathname}`;
  } catch {
    return url;
  }
}

const THEME_SEARCH_KEYWORDS: Record<ThemeId, string[]> = {
  renraku: ["保育園 連絡帳", "病院予約 主婦 つらい", "学校 連絡 めんどくさい", "習い事 振替 連絡"],
  schedule: ["家族 予定 共有 主婦", "送迎 ママ つらい", "スケジュール管理 主婦"],
  paperwork: ["学校 プリント めんどくさい", "PTA 連絡帳", "お便り 整理 主婦"],
  money: ["主婦 家計簿 つらい", "レシート 管理 ママ", "ふるさと納税 忘れる"],
  custom: [],
};

async function filterToHousewifePlatforms(results: SearchResult[]): Promise<SearchResult[]> {
  const allowedDomains = await getAllowedPlatformDomains();
  return results.filter((r) => allowedDomains.some((d) => r.domain.includes(d)));
}

async function attachPlatformLabel(results: SearchResult[]) {
  return Promise.all(
    results.map(async (r) => ({
      ...r,
      platformLabel: await platformLabelForDomainAsync(r.domain),
    })),
  );
}

export async function POST(req: Request) {
  try {
    let mode: FeedSourceMode = "scheduled";
    let customTheme: string | undefined;
    let derivativeArticleId: string | undefined;

    try {
      const body = await req.json();
      if (body?.mode === "free" && typeof body.theme === "string" && body.theme.trim()) {
        mode = "free";
        customTheme = body.theme.trim();
      } else if (body?.mode === "derivative" && typeof body.articleId === "string") {
        mode = "derivative";
        derivativeArticleId = body.articleId;
      }
    } catch {
      // body無し = scheduled tick
    }

    const before = await loadFeed();
    let themeId: ThemeId;
    let themeLabel: string;
    let themeDesc: string;
    let customLabel: string | undefined;
    let searchKeywords: string[] = [];
    let derivativePromptOnly = false;
    let prompt: string;

    if (mode === "free" && customTheme) {
      themeId = "custom";
      themeLabel = customTheme;
      themeDesc = customTheme;
      customLabel = customTheme;
      searchKeywords = [customTheme];
      prompt = ""; // built later from search results
    } else if (mode === "derivative" && derivativeArticleId) {
      const articles = await loadArticles();
      const article = articles.find((a) => a.id === derivativeArticleId);
      if (!article) {
        return Response.json({ error: "元記事が見つかりません" }, { status: 404 });
      }
      const articleFeed = article.idea as FeedIdea;
      const themeMeta = THEMES.find((t) => t.id === articleFeed.themeId) ?? THEMES[0];
      themeId = articleFeed.themeId;
      themeLabel = `派生:${article.bestTitle.slice(0, 20)}`;
      themeDesc = themeMeta.desc;
      customLabel = `派生 ← ${article.bestTitle.slice(0, 30)}`;
      derivativePromptOnly = true;
      prompt = RESEARCH_DERIVATIVE_PROMPT({
        title: article.bestTitle,
        toolConcept: articleFeed.toolConcept,
        angle: article.idea.angle,
        themeLabel: themeMeta.label,
        themeDesc: themeMeta.desc,
      });
    } else {
      const theme = pickNextTheme(before.tickCount ?? 0);
      themeId = theme.id;
      themeLabel = theme.label;
      themeDesc = theme.desc;
      searchKeywords = THEME_SEARCH_KEYWORDS[theme.id] ?? [];
      prompt = "";
    }

    let usedSearch = false;
    let searchResultCount = 0;
    const providerByUrl = new Map<string, "brave" | "google">();
    const providerStats = { brave: 0, google: 0 };

    // モード分岐: 検索ベース vs 旧Search Grounding
    if (!derivativePromptOnly && (isProviderAvailable("brave") || isProviderAvailable("google"))) {
      // 実検索パイプライン
      const queries = await buildSearchQueriesAsync(searchKeywords, { maxQueries: 6 });
      const allResults = await multiSearch(queries, { perQueryCount: 5 });
      const filtered = await filterToHousewifePlatforms(allResults);
      const top = (await attachPlatformLabel(filtered)).slice(0, 20);
      searchResultCount = top.length;

      // URL→provider マップを構築（後でvoice.urlに紐づける）
      for (const r of top) {
        providerByUrl.set(normalizeForLookup(r.url), r.provider);
        providerStats[r.provider]++;
      }

      if (top.length >= 3) {
        usedSearch = true;
        prompt = RESEARCH_FROM_SEARCH_PROMPT(themeLabel, themeDesc, top);
      } else {
        // 検索結果不足 → fallback to Search Grounding
        prompt =
          mode === "free" && customTheme
            ? RESEARCH_FREE_PROMPT(customTheme)
            : RESEARCH_FEED_PROMPT(themeLabel, themeDesc);
      }
    } else if (!derivativePromptOnly) {
      // 検索プロバイダなし → Search Grounding
      prompt =
        mode === "free" && customTheme
          ? RESEARCH_FREE_PROMPT(customTheme)
          : RESEARCH_FEED_PROMPT(themeLabel, themeDesc);
    }

    const text = await callGemini(prompt, { useGoogleSearch: !usedSearch });
    const raw = extractJson(text) as RawProposal[];

    const newIdeas = transformProposals(raw, {
      themeId,
      customLabel,
      sourceMode: mode,
      providerByUrl,
      defaultProvider: usedSearch ? undefined : "ai",
    });

    const result = await appendIdeas(newIdeas);
    return Response.json({
      tickAt: new Date().toISOString(),
      mode,
      themeLabel,
      usedSearch,
      searchResultCount,
      providerStats,
      added: result.added,
      skipped: result.skipped,
      total: result.state.ideas.length,
      addedIdeas: result.addedIdeas,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
