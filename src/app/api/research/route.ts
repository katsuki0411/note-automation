import { NextRequest } from "next/server";
import { gemini, MODELS } from "@/lib/gemini";
import { RESEARCH_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 180;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("JSONの配列が見つかりません");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

const FALLBACK_MODELS = [MODELS.research, "gemini-2.5-flash-lite", "gemini-2.0-flash"];

async function callWithRetry(theme: string) {
  const ai = gemini();
  let lastErr: unknown;
  for (const model of FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: RESEARCH_PROMPT(theme),
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.9,
          },
        });
        return response.text ?? "";
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /\b(429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(msg);
        if (!transient) throw e;
        const wait = 1500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr ?? new Error("Gemini呼び出しに失敗しました");
}

export async function POST(req: NextRequest) {
  try {
    const { theme } = await req.json();
    if (!theme || typeof theme !== "string") {
      return Response.json({ error: "themeが必要です" }, { status: 400 });
    }
    const text = await callWithRetry(theme);
    const ideas = extractJson(text);
    return Response.json({ ideas });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
