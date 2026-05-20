import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { KW_TO_PROPOSAL_PROMPT } from "@/lib/prompts";
import { appendIdeas } from "@/lib/feed";
import {
  isProviderAvailable,
  multiSearch,
  platformLabelForDomainAsync,
  getAllowedPlatformDomains,
  type SearchResult,
} from "@/lib/searchProviders";
import {
  createKeyword,
  findKeyword,
  type CreateKeywordInput,
} from "@/lib/keywords";
import { THEMES, type FeedIdea, type ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 180;

function repairJson(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1").trim();
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("JSON配列が見つかりません");
  cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(repairJson(cleaned));
  }
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

async function callGemini(prompt: string): Promise<string> {
  const ai = gemini();
  const response = await ai.models.generateContent({
    model: MODELS.research,
    contents: prompt,
    config: { temperature: 0.85, maxOutputTokens: 8000 },
  });
  return response.text ?? "";
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const {
        kw,
        themeId,
        subcategoryId = "other",
        addToDictionary = true,
      } = (await req.json()) as {
        kw: string;
        themeId: ThemeId;
        subcategoryId?: string;
        addToDictionary?: boolean;
      };

      if (!kw?.trim() || !themeId) {
        return Response.json({ error: "kw, themeId は必須" }, { status: 400 });
      }

      const theme = THEMES.find((t) => t.id === themeId);
      if (!theme) return Response.json({ error: "themeId 不正" }, { status: 400 });

      // 1. Brave検索 → voice候補取得
      let searchResults: (SearchResult & { platformLabel?: string })[] = [];
      const providerByUrl = new Map<string, "brave" | "google">();
      if (isProviderAvailable("brave") || isProviderAvailable("google")) {
        const queries = [`主婦 ${kw}`, `ママ ${kw} 悩み`, `${kw} つらい`];
        const allDomains = await getAllowedPlatformDomains(ctx.projectId);
        const allResults = await multiSearch(queries, { perQueryCount: 5 });
        const filtered = allResults.filter((r) =>
          allDomains.some((d) => r.domain.includes(d)),
        );
        searchResults = await Promise.all(
          filtered.slice(0, 12).map(async (r) => ({
            ...r,
            platformLabel: await platformLabelForDomainAsync(ctx.projectId, ctx.userId, r.domain),
          })),
        );
        for (const r of searchResults) {
          providerByUrl.set(normalizeForLookup(r.url), r.provider);
        }
      }

      // 2. Gemini で proposal を1件生成
      const prompt = KW_TO_PROPOSAL_PROMPT(kw, theme.label, theme.desc, searchResults);
      const text = await callGemini(prompt);

      type Raw = {
        voice?: { quote?: string; platform?: string; url?: string; context?: string };
        proposal?: {
          title?: string;
          hook?: string;
          angle?: string;
          tool_concept?: string;
          keywords?: { primary?: string; secondary?: string[]; long_tail?: string[] };
          target?: {
            persona?: string;
            age_range?: string;
            family_status?: string;
            pain_intensity?: number;
          };
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
      const raw = extractJson(text) as Raw[];
      const r = raw[0];
      if (!r?.proposal?.title || !r?.voice?.quote) {
        throw new Error("proposalの生成に失敗（必須フィールド欠如）");
      }

      // 3. KW を辞書に登録（あれば再利用）
      let kwRecord = await findKeyword(ctx.projectId, kw, themeId);
      if (!kwRecord && addToDictionary) {
        const kwInput: CreateKeywordInput = {
          themeId,
          subcategoryId,
          kw,
          intent: "trouble",
          vol: (r.proposal.impression?.monthly_search_volume as
            | "high"
            | "medium"
            | "low"
            | "niche"
            | undefined) ?? "medium",
          comp: (r.proposal.impression?.competition_level as
            | "high"
            | "medium"
            | "low"
            | undefined) ?? "medium",
          priority: r.proposal.priority_score ?? 70,
          status: "targeted",
          memo: "ホットKW発見から自動投入",
        };
        kwRecord = await createKeyword(ctx.projectId, ctx.userId, kwInput);
      }

      // 4. FeedIdea 構築
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
      const platform = r.voice.platform ?? "AI生成（実投稿未取得）";
      const isAIVoice =
        searchResults.length === 0 ||
        /AI生成|未取得|生成|fictional/i.test(platform);
      const matchedProvider = r.voice.url
        ? providerByUrl.get(normalizeForLookup(r.voice.url))
        : undefined;
      const finalProvider = matchedProvider ?? (isAIVoice ? "ai" : "brave");

      const feedIdea: Omit<FeedIdea, "id" | "createdAt"> = {
        title: r.proposal.title,
        hook: r.proposal.hook ?? "",
        angle: r.proposal.angle ?? "",
        toolConcept: r.proposal.tool_concept ?? "",
        keywords: r.proposal.keywords?.primary
          ? {
              primary: r.proposal.keywords.primary,
              secondary: r.proposal.keywords.secondary ?? [],
              longTail: r.proposal.keywords.long_tail ?? [],
            }
          : undefined,
        target: r.proposal.target?.persona
          ? {
              persona: r.proposal.target.persona,
              ageRange: r.proposal.target.age_range ?? "",
              familyStatus: r.proposal.target.family_status ?? "",
              painIntensity: (Math.max(
                1,
                Math.min(5, r.proposal.target.pain_intensity ?? 3),
              ) as 1 | 2 | 3 | 4 | 5),
            }
          : undefined,
        impression: r.proposal.impression
          ? {
              monthlySearchVolume: clampVol(r.proposal.impression.monthly_search_volume),
              monthlySearchVolumeNote: r.proposal.impression.monthly_search_volume_note ?? "",
              competitionLevel: clampLvl(r.proposal.impression.competition_level),
              notePotential: clampLvl(r.proposal.impression.note_potential),
              notePotentialReason: r.proposal.impression.note_potential_reason ?? "",
              reachEstimateMonthly: r.proposal.impression.reach_estimate_monthly ?? "",
            }
          : undefined,
        priorityScore:
          typeof r.proposal.priority_score === "number"
            ? Math.max(1, Math.min(100, Math.round(r.proposal.priority_score)))
            : 80,
        voice: {
          quote: r.voice.quote,
          platform,
          url: r.voice.url || undefined,
          context: r.voice.context || undefined,
          searchProvider: finalProvider,
        },
        source: "gemini",
        themeId,
        customLabel: `KW: ${kw}`,
        sourceMode: "free",
        targetKeywordId: kwRecord?.id,
      };

      // 5. Feedに追加
      const result = await appendIdeas(ctx.projectId, ctx.userId, [feedIdea]);
      const savedIdea = result.state.ideas.find(
        (i) => i.title === feedIdea.title && i.targetKeywordId === feedIdea.targetKeywordId,
      );

      return Response.json({
        ok: true,
        feedIdea: savedIdea ?? null,
        voiceCandidates: searchResults.length,
        voiceProvider: finalProvider,
        kwRecord,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
