import { gemini, MODELS } from "./gemini";
import { DISCOVER_HOT_KEYWORDS_PROMPT } from "./prompts";
import { THEMES, type ThemeId } from "./types";

export type HotKeyword = {
  kw: string;
  volumeHint: "high" | "medium" | "low" | "niche";
  competitionHint: "high" | "medium" | "low";
  riseStatus: "rising" | "stable" | "declining";
  intent: "info" | "how-to" | "comparison" | "trouble";
  priority: number;
  whyHot: string;
  sources: string[];
  themeId: ThemeId;
  discoveredAt: string;
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
    why_hot?: string;
    sources?: unknown;
  }>;

  const now = new Date().toISOString();
  return raw
    .filter((r) => r?.kw && r.kw.trim())
    .map((r) => ({
      kw: r.kw!.trim(),
      volumeHint: clamp(r.volume_hint, ALLOWED_VOL, "medium"),
      competitionHint: clamp(r.competition_hint, ALLOWED_COMP, "medium"),
      riseStatus: clamp(r.rise_status, ALLOWED_RISE, "stable"),
      intent: clamp(r.intent, ALLOWED_INTENT, "trouble"),
      priority:
        typeof r.priority === "number"
          ? Math.max(1, Math.min(100, Math.round(r.priority)))
          : 50,
      whyHot: r.why_hot ?? "",
      sources: Array.isArray(r.sources)
        ? r.sources
            .map((x) => String(x).trim())
            .filter((x) => x.length > 0)
            .slice(0, 6)
        : [],
      themeId,
      discoveredAt: now,
    }))
    .sort((a, b) => b.priority - a.priority);
}
