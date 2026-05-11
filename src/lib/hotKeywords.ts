import { gemini, MODELS } from "./gemini";
import { DISCOVER_HOT_KEYWORDS_PROMPT } from "./prompts";
import {
  multiSearch,
  getAllowedPlatformDomains,
  platformLabelForDomainAsync,
  isProviderAvailable,
} from "./searchProviders";
import { THEMES, type ThemeId } from "./types";

export type HotKeyword = {
  kw: string;
  volumeHint: "high" | "medium" | "low" | "niche";
  competitionHint: "high" | "medium" | "low";
  riseStatus: "rising" | "stable" | "declining";
  intent: "info" | "how-to" | "comparison" | "trouble";
  priority: number;
  painIntensity: 1 | 2 | 3 | 4 | 5;
  whyHot: string;
  sources: string[];
  themeId: ThemeId;
  discoveredAt: string;
  // 実検索による検証結果（後付け）
  verifiedHits?: number;
  verifiedAt?: string;
  verifyStatus?: "verified" | "no-hits" | "search-failed";
  sampleUrls?: string[];
};

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

const FALLBACK_MODELS = [MODELS.research, "gemini-2.5-flash-lite", "gemini-2.0-flash"];

async function callGeminiWithGrounding(prompt: string): Promise<string> {
  const ai = gemini();
  let lastErr: unknown;
  for (const model of FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.85,
            maxOutputTokens: 6000,
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

const ALLOWED_VOL = ["high", "medium", "low", "niche"] as const;
const ALLOWED_COMP = ["high", "medium", "low"] as const;
const ALLOWED_RISE = ["rising", "stable", "declining"] as const;
const ALLOWED_INTENT = ["info", "how-to", "comparison", "trouble"] as const;

function clamp<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
}

export async function discoverHotKeywordsForTheme(themeId: ThemeId): Promise<HotKeyword[]> {
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) throw new Error(`unknown theme: ${themeId}`);
  const text = await callGeminiWithGrounding(DISCOVER_HOT_KEYWORDS_PROMPT(theme.label, theme.desc));
  const raw = extractJson(text) as Array<{
    kw?: string;
    volume_hint?: string;
    competition_hint?: string;
    rise_status?: string;
    intent?: string;
    priority?: number;
    pain_intensity?: number;
    why_hot?: string;
    sources?: unknown;
  }>;

  const now = new Date().toISOString();
  return raw
    .filter((r) => r?.kw && r.kw.trim())
    .map((r) => {
      const pain =
        typeof r.pain_intensity === "number"
          ? Math.max(1, Math.min(5, Math.round(r.pain_intensity)))
          : 3;
      return {
        kw: r.kw!.trim(),
        volumeHint: clamp(r.volume_hint, ALLOWED_VOL, "medium"),
        competitionHint: clamp(r.competition_hint, ALLOWED_COMP, "medium"),
        riseStatus: clamp(r.rise_status, ALLOWED_RISE, "stable"),
        intent: clamp(r.intent, ALLOWED_INTENT, "trouble"),
        priority:
          typeof r.priority === "number"
            ? Math.max(1, Math.min(100, Math.round(r.priority)))
            : 50,
        painIntensity: pain as 1 | 2 | 3 | 4 | 5,
        whyHot: r.why_hot ?? "",
        sources: Array.isArray(r.sources)
          ? r.sources
              .map((x) => String(x).trim())
              .filter((x) => x.length > 0)
              .slice(0, 6)
          : [],
        themeId,
        discoveredAt: now,
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

/**
 * ホットキーワード候補を実検索で検証する。
 * - 許可ドメイン（platforms.json）に対して検索を投げ、ヒット数と実プラットフォーム名を取得
 * - 0件のものは "no-hits"、検索プロバイダ未設定/失敗は "search-failed" マーク
 * - sources は実ヒットしたドメインのラベルで上書き
 */
export async function verifyHotKeyword(hot: HotKeyword): Promise<HotKeyword> {
  const providersAvailable =
    isProviderAvailable("brave") || isProviderAvailable("google");
  if (!providersAvailable) {
    return { ...hot, verifyStatus: "search-failed", verifiedAt: new Date().toISOString() };
  }

  try {
    const results = await multiSearch([hot.kw], { perQueryCount: 5 });
    const allowed = await getAllowedPlatformDomains();
    const matched = results.filter((r) =>
      allowed.some((d) => r.domain.includes(d)),
    );

    if (matched.length === 0) {
      return { ...hot, verifyStatus: "no-hits", verifiedHits: 0, verifiedAt: new Date().toISOString() };
    }

    const labelSet = new Set<string>();
    for (const r of matched) {
      const label = await platformLabelForDomainAsync(r.domain);
      labelSet.add(label);
    }

    return {
      ...hot,
      sources: [...labelSet].slice(0, 6),
      verifiedHits: matched.length,
      verifyStatus: "verified",
      verifiedAt: new Date().toISOString(),
      sampleUrls: matched.slice(0, 3).map((r) => r.url),
    };
  } catch {
    return { ...hot, verifyStatus: "search-failed", verifiedAt: new Date().toISOString() };
  }
}

/**
 * 並列度を制限しながら検証
 */
export async function verifyHotKeywords(
  candidates: HotKeyword[],
  opts: { concurrency?: number } = {},
): Promise<HotKeyword[]> {
  const concurrency = opts.concurrency ?? 5;
  const out: HotKeyword[] = new Array(candidates.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= candidates.length) return;
      out[i] = await verifyHotKeyword(candidates[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
