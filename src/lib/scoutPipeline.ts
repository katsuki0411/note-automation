import "server-only";
import { gemini, MODELS } from "./gemini";
import { expandKeywords, type ExpandedKeyword, type ScoutCategory } from "./keywordExpander";
import {
  searchVolumeBulk,
  fetchSerpAdvanced,
  type KeywordOverviewItem,
  type SerpAdvancedResponse,
} from "./dataforseo";
import { renderTemplate } from "./promptTemplate";

// =========================================================
// KW スカウト 5段パイプライン (2026-06-10 リファクタ)
// =========================================================
// Stage 1: Gemini #1  KW候補 100件生成
// Stage 2: DFS    #1  Keyword Overview Live (SV/CPC/Intent/Trend/...)
// Stage 3: Gemini #2  数値 + 重複/不適切排除で 1次絞り込み
// Stage 4: DFS    #2  SERP Organic Live Advanced (SERP feature + AI Overview)
// Stage 5: Gemini #3  全情報を見て最終判定 (rationale 強制出力)
//
// 旧8段から Bulk KD と Stage 3 KD閾値絞り込みを撤廃。理由:
//   DataForSEO の KD は Backlinks サブスクが必要で、未契約時は KD=0/null を
//   返す。事実上 Stage 3 KD絞り込みが機能していなかったため、SV/CPC/intent +
//   SERP の中身判定で十分と判断 (タスク #107)。
// =========================================================

// ---------- 公開型 ----------

export type ScoutDecision = "adopt" | "borderline" | "reject";

export type ScoutFinalCandidate = {
  kw: string;
  // Stage 1 由来 (Gemini #1 が付けた intent + 選定理由)
  intent: ExpandedKeyword["intent"];
  reason: string;

  // Stage 2 由来 (DFS Keyword Overview)
  kd: number | null;                // 取得できれば入る (Backlinks 未契約なら null/0)
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;       // 0-1
  competitionLevel: string | null;
  searchIntent: string | null;
  monthlySearches: KeywordOverviewItem["monthlySearches"];
  avgBacklinksMain: number | null;
  avgBacklinksReferringDomains: number | null;
  serpItemTypes: string[];

  // Stage 4 由来 (SERP Advanced)
  serpFeatures: SerpAdvancedResponse["features"];
  serpTopUrls: string[];
  aiOverviewReferences: SerpAdvancedResponse["aiOverviewReferences"];
  paaQuestions: string[];

  // Stage 5 由来 (Gemini #3 最終判定)
  finalScore: number;         // 0-100
  decision: ScoutDecision;
  rationale: string;          // 採用/却下の根拠 (必須出力)
};

export type ScoutStageStats = {
  stage1Generated: number;    // Gemini #1 が出した数
  stage3Passed: number;       // Gemini #2 (数値+絞り込み) を通過した数
  finalCount: number;         // 最終候補数 (decision 関係なく)
  adoptedCount: number;       // decision="adopt" の数
};

// 各 KW がパイプラインのどこまで進んだかを示すステータス。
export type StageStatus =
  | "stage3_rejected"   // Stage 3 で Gemini #2 が落とした (重複/不適切/数値NG)
  | "stage5_evaluated"; // Stage 5 まで通過 (decision は candidates 側に入る)

export type ScoutAllCandidate = {
  kw: string;
  intent: ExpandedKeyword["intent"];
  reason: string;
  stage: StageStatus;
  // Stage 2 で取得した数値 (落選時にも UI に出すため記録)
  kd?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  competitionLevel?: string | null;
  searchIntent?: string | null;
  rejectionNote?: string;
};

export type ScoutPipelineResult = {
  subject: string;
  category: ScoutCategory;
  stats: ScoutStageStats;
  candidates: ScoutFinalCandidate[];
  // Stage 1 で生成されたが Stage 3 で落選した KW
  rejectedCandidates: ScoutAllCandidate[];
};

export type ScoutPipelineConfig = {
  kwCandidateCount?: number;            // Gemini #1 生成数 (default 100)
  minSv?: number;                       // SV >= この値 を通過 (default 100)
  minCpc?: number;                      // CPC >= この値 USD (default 0.2)
  maxFinalCount?: number;               // 最終判定に回すKW数の上限 (default 10)
  excludeKws?: string[];                // 除外KW (プロジェクト単位)
  // Gemini プロンプト override
  promptKwGen?: string;                 // Stage 1: keywordExpander.customPrompt
  promptStage3?: string | ((input: Stage3PromptInput) => string);
  promptFinal?: string | ((input: FinalPromptInput) => string);
};

// ---------- Gemini プロンプト入力 (型) ----------

export type Stage3PromptInput = {
  subject: string;
  category: ScoutCategory;
  keywords: Array<{
    kw: string;
    intent: string;
    reason: string;
    searchVolume: number | null;
    cpc: number | null;
    competitionLevel: string | null;
    searchIntent: string | null;
  }>;
  minSv: number;
  minCpc: number;
  maxFinalCount: number;
};

export type FinalPromptInput = {
  subject: string;
  candidates: Array<{
    kw: string;
    kd: number | null;
    searchVolume: number | null;
    cpc: number | null;
    serpFeatures: SerpAdvancedResponse["features"];
    paaSample: string[];          // 上位3つだけ
    aiOverviewDomains: string[];  // AI Overview に引用されているドメイン
    serpTopDomains: string[];     // 上位10件のドメイン
  }>;
};

// ---------- 通貨表記ヘルパー ----------
const JPY_PER_USD = 150;
function cpcJpy(cpcUsd: number | null | undefined): string {
  if (cpcUsd === null || cpcUsd === undefined) return "?";
  return `¥${Math.round(cpcUsd * JPY_PER_USD)}`;
}

// ---------- デフォルト Gemini プロンプト ----------

function defaultStage3Prompt(i: Stage3PromptInput): string {
  const { subject, category, keywords, minSv, minCpc, maxFinalCount } = i;
  const list = keywords
    .map(
      (k, idx) =>
        `${idx + 1}. ${k.kw} (intent=${k.intent}, SV=${k.searchVolume ?? "?"}, CPC=${cpcJpy(k.cpc)}, 競合=${k.competitionLevel ?? "?"}, dfs_intent=${k.searchIntent ?? "?"}) - ${k.reason}`,
    )
    .join("\n");
  return `
あなたはアフィリエイト記事を書く専門家です。
商品「${subject}」(カテゴリ: ${category}) のキーワード候補から、CV (購入/問い合わせ) に
つながりそうな KW を最大 ${maxFinalCount} 件選んでください。

【絞り込み基準】
1. SV >= ${minSv} (検索数が一定以上ある)
2. CPC >= ${cpcJpy(minCpc)} (広告出稿価値がある = 商業意図がある)
3. dfs_intent が commercial / transactional 寄り
4. 「比較」「おすすめ」「口コミ」「使い方」など購入直前KW
5. 同じ意味の重複 (例: "${subject} 価格" と "${subject} 値段") は片方だけ
6. 商品名と無関係なジャンル混入は除外
※ SV/CPC が null の KW も、有望なら通してOK (DFS が拾えていないだけかも)

【KW候補 (${keywords.length}件)】
${list}

【出力 (JSONのみ、フェンス禁止)】
{
  "selected": ["KW1", "KW2", ...],
  "rationale": "選んだ全体方針の簡潔な説明 (1-2文)"
}
`.trim();
}

function defaultFinalPrompt(i: FinalPromptInput): string {
  const { subject, candidates } = i;
  return `
あなたは SEO + アフィリエイトの専門家です。
商品「${subject}」のキーワード候補について、SERP の状況を見て採用判定してください。

【判定基準】
- adopt: 上位10件に個人ブログ/中堅サイトが入っており、新規記事でも食い込める
- borderline: 大手と個人ブログが混在、難易度中
- reject: 大手 (Amazon/楽天/mybest/公式) で埋まっており勝ち目薄

【候補】
${candidates
  .map(
    (c, idx) =>
      `${idx + 1}. ${c.kw}
   KD=${c.kd ?? "?"}, SV=${c.searchVolume ?? "?"}, CPC=${cpcJpy(c.cpc)}
   SERP features: ${Object.entries(c.serpFeatures).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}
   Top10 domains: ${c.serpTopDomains.slice(0, 10).join(", ") || "(none)"}
   AI Overview引用: ${c.aiOverviewDomains.join(", ") || "(none)"}
   PAA: ${c.paaSample.join(" / ") || "(none)"}`,
  )
  .join("\n\n")}

【出力 (JSONのみ、フェンス禁止)】
{
  "decisions": [
    {
      "kw": "対象KW",
      "finalScore": 75,
      "decision": "adopt",
      "rationale": "Top10にmacaro-ni.jp/ameblo.jp等の個人ブログが過半数。AI Overview引用元にも入りやすい。"
    }
  ]
}
`.trim();
}

// ---------- プロンプトテンプレート変数 ----------

function stage3Vars(i: Stage3PromptInput): Record<string, string | number> {
  return {
    subject: i.subject,
    category: i.category,
    minSv: i.minSv,
    minCpc: cpcJpy(i.minCpc),
    maxFinalCount: i.maxFinalCount,
    keywords: i.keywords
      .map(
        (k, idx) =>
          `${idx + 1}. ${k.kw} (intent=${k.intent}, SV=${k.searchVolume ?? "?"}, CPC=${cpcJpy(k.cpc)}, dfs_intent=${k.searchIntent ?? "?"})`,
      )
      .join("\n"),
  };
}

function finalVars(i: FinalPromptInput): Record<string, string | number> {
  return {
    subject: i.subject,
    candidates: i.candidates
      .map(
        (c, idx) =>
          `${idx + 1}. ${c.kw} (KD=${c.kd ?? "?"}, SV=${c.searchVolume ?? "?"}, CPC=${cpcJpy(c.cpc)})`,
      )
      .join("\n"),
  };
}

function resolveStagePrompt<TInput>(
  override: string | ((i: TInput) => string) | undefined,
  defaultFn: (i: TInput) => string,
  toVars: (i: TInput) => Record<string, string | number>,
  outputFooter: string,
): (i: TInput) => string {
  if (typeof override === "function") return override;
  if (typeof override === "string" && override.trim()) {
    return (i) => `${renderTemplate(override, toVars(i))}\n\n${outputFooter}`;
  }
  return defaultFn;
}

const STAGE3_FOOTER = `# 出力 (JSONのみ、フェンス禁止)
{
  "selected": ["KW1", "KW2"],
  "rationale": "..."
}`;

const FINAL_FOOTER = `# 出力 (JSONのみ、フェンス禁止)
{
  "decisions": [
    {
      "kw": "対象KW",
      "finalScore": 75,
      "decision": "adopt",
      "rationale": "kd=18と低く、Top10に個人ブログが過半数..."
    }
  ]
}`;

// ---------- Gemini 呼出ヘルパー ----------

async function callGeminiJson<T>(prompt: string, schema: object, maxTokens = 6000): Promise<T> {
  const ai = gemini();
  const res = await ai.models.generateContent({
    model: MODELS.research,
    contents: prompt,
    config: {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  const text = res.text ?? "";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!cleaned) {
    const finishReason = res.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini returned empty response (finishReason=${finishReason})`);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as T;
        console.warn(`[callGeminiJson] recovered from truncation. original len=${cleaned.length}`);
        return parsed;
      } catch {
        // fallthrough
      }
    }
    console.warn(
      `[callGeminiJson] parse failed (len=${cleaned.length}). head=`,
      cleaned.slice(0, 200),
      `tail=`,
      cleaned.slice(-200),
    );
    throw e;
  }
}

function repairTruncatedJson(s: string): string | null {
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace < 0) return null;
  let trimmed = s.slice(0, lastBrace + 1);
  let openCurly = 0;
  let openBracket = 0;
  let inStr = false;
  let esc = false;
  for (const ch of trimmed) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") openCurly++;
    else if (ch === "}") openCurly--;
    else if (ch === "[") openBracket++;
    else if (ch === "]") openBracket--;
  }
  while (openBracket > 0) { trimmed += "]"; openBracket--; }
  while (openCurly > 0) { trimmed += "}"; openCurly--; }
  return trimmed;
}

// ---------- 個別ステージ ----------

async function stage3FilterByMetrics(
  subject: string,
  category: ScoutCategory,
  expanded: ExpandedKeyword[],
  overviewItems: KeywordOverviewItem[],
  config: ScoutPipelineConfig,
): Promise<ExpandedKeyword[]> {
  const minSv = config.minSv ?? 100;
  const minCpc = config.minCpc ?? 0.2;
  const maxFinalCount = config.maxFinalCount ?? 10;

  // DFS は keyword を lower-case で返すことがあるため、マップキーは全部小文字統一。
const overviewMap = new Map(overviewItems.map((o) => [o.kw.toLowerCase(), o]));

  const promptInput: Stage3PromptInput = {
    subject,
    category,
    keywords: expanded.map((kw) => {
      const ov = overviewMap.get(kw.kw.toLowerCase());
      return {
        kw: kw.kw,
        intent: kw.intent,
        reason: kw.reason,
        searchVolume: ov?.searchVolume ?? null,
        cpc: ov?.cpc ?? null,
        competitionLevel: ov?.competitionLevel ?? null,
        searchIntent: ov?.searchIntent ?? null,
      };
    }),
    minSv,
    minCpc,
    maxFinalCount,
  };
  const promptFn = resolveStagePrompt(
    config.promptStage3,
    defaultStage3Prompt,
    stage3Vars,
    STAGE3_FOOTER,
  );
  const prompt = promptFn(promptInput);

  try {
    const result = await callGeminiJson<{ selected: string[]; rationale?: string }>(
      prompt,
      {
        type: "object",
        properties: {
          selected: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: ["selected"],
      },
      12000,
    );
    const selectedSet = new Set(result.selected.map((s) => s.toLowerCase()));
    return expanded.filter((kw) => selectedSet.has(kw.kw.toLowerCase())).slice(0, maxFinalCount);
  } catch (e) {
    console.warn(`[stage3FilterByMetrics] Gemini failed, fallback to threshold-only:`, e);
    return expanded
      .filter((kw) => {
        const ov = overviewMap.get(kw.kw.toLowerCase());
        const sv = ov?.searchVolume ?? 0;
        const cpc = ov?.cpc ?? 0;
        return sv >= minSv && cpc >= minCpc;
      })
      .slice(0, maxFinalCount);
  }
}

async function stage5FinalDecision(
  subject: string,
  candidates: ScoutFinalCandidate[],
  config: ScoutPipelineConfig,
): Promise<ScoutFinalCandidate[]> {
  if (candidates.length === 0) return [];

  const promptInput: FinalPromptInput = {
    subject,
    candidates: candidates.map((c) => ({
      kw: c.kw,
      kd: c.kd,
      searchVolume: c.searchVolume,
      cpc: c.cpc,
      serpFeatures: c.serpFeatures,
      paaSample: c.paaQuestions.slice(0, 3),
      aiOverviewDomains: Array.from(
        new Set(c.aiOverviewReferences.map((r) => r.domain ?? extractDomain(r.url))),
      ).filter(Boolean) as string[],
      serpTopDomains: c.serpTopUrls.map((u) => extractDomain(u) ?? "").filter(Boolean),
    })),
  };
  const promptFn = resolveStagePrompt(
    config.promptFinal,
    defaultFinalPrompt,
    finalVars,
    FINAL_FOOTER,
  );
  const prompt = promptFn(promptInput);

  try {
    const result = await callGeminiJson<{
      decisions: Array<{ kw: string; finalScore: number; decision: string; rationale: string }>;
    }>(
      prompt,
      {
        type: "object",
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kw: { type: "string" },
                finalScore: { type: "number" },
                decision: { type: "string" },
                rationale: { type: "string" },
              },
              required: ["kw", "finalScore", "decision", "rationale"],
            },
          },
        },
        required: ["decisions"],
      },
      24000,
    );
    const decisionMap = new Map(result.decisions.map((d) => [d.kw.toLowerCase(), d]));
    return candidates.map((c) => {
      const d = decisionMap.get(c.kw.toLowerCase());
      if (!d) {
        return { ...c, finalScore: 50, decision: "borderline" as const, rationale: "(AI判定取得失敗)" };
      }
      const decision: ScoutDecision =
        d.decision === "adopt" || d.decision === "reject" ? d.decision : "borderline";
      return {
        ...c,
        finalScore: Math.max(0, Math.min(100, Math.round(d.finalScore))),
        decision,
        rationale: d.rationale,
      };
    });
  } catch (e) {
    console.warn(`[stage5FinalDecision] Gemini failed, mark all as borderline:`, e);
    return candidates.map((c) => ({
      ...c,
      finalScore: 50,
      decision: "borderline" as const,
      rationale: `(AI判定失敗: ${e instanceof Error ? e.message : "unknown"})`,
    }));
  }
}

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// ---------- メインエントリ ----------

export async function runScoutPipeline(
  subject: string,
  config: ScoutPipelineConfig = {},
): Promise<ScoutPipelineResult> {
  // Stage 1: Gemini #1  KW候補生成
  const { keywords: expanded, category } = await expandKeywords(subject, {
    excludeKws: config.excludeKws,
    maxKeywords: config.kwCandidateCount ?? 100,
    customPrompt: config.promptKwGen,
  });

  if (expanded.length === 0) {
    return {
      subject,
      category,
      stats: { stage1Generated: 0, stage3Passed: 0, finalCount: 0, adoptedCount: 0 },
      candidates: [],
      rejectedCandidates: [],
    };
  }

  // Stage 2: DFS Google Ads Search Volume (bulk対応)
  // Keyword Overview Live は 1リクエスト 1KW しか返さないため、bulk な
  // Search Volume API に切替。SV/CPC/competition は取れるが KD は取れない
  // (KD は Backlinks 契約後に Keyword Overview 経由で別途追加する想定)。
  const overviewItems = await searchVolumeBulk(expanded.map((k) => k.kw));
  // DFS は keyword を lower-case で返すことがあるため、マップキーは全部小文字統一。
  const overviewMap = new Map(overviewItems.map((o) => [o.kw.toLowerCase(), o]));
  // 取得状況を診断ログに残す (キーが一致しない事象の早期発見用)
  const matchedCount = expanded.filter((k) => overviewMap.has(k.kw.toLowerCase())).length;
  console.log(
    `[scoutPipeline] Stage2 overview: requested=${expanded.length}, returned=${overviewItems.length}, matched=${matchedCount}`,
  );
  if (matchedCount === 0 && expanded.length > 0) {
    console.warn(
      `[scoutPipeline] No overview match! sample requested="${expanded[0]?.kw}" vs returned="${overviewItems[0]?.kw ?? "(none)"}"`,
    );
  }

  // Stage 3: Gemini #2  数値 + 重複/不適切排除で 1次絞り込み
  const stage3Pass = await stage3FilterByMetrics(subject, category, expanded, overviewItems, config);
  const stage3PassSet = new Set(stage3Pass.map((k) => k.kw));

  // Stage 3 で落選した KW を rejectedCandidates に記録
  const rejected: ScoutAllCandidate[] = [];
  for (const kw of expanded) {
    if (stage3PassSet.has(kw.kw)) continue;
    const ov = overviewMap.get(kw.kw.toLowerCase());
    rejected.push({
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      stage: "stage3_rejected",
      kd: ov?.keywordDifficulty ?? null,
      searchVolume: ov?.searchVolume ?? null,
      cpc: ov?.cpc ?? null,
      competitionLevel: ov?.competitionLevel ?? null,
      searchIntent: ov?.searchIntent ?? null,
      rejectionNote: "Gemini #2 が数値/重複/不適切と判定して除外",
    });
  }

  if (stage3Pass.length === 0) {
    return {
      subject,
      category,
      stats: {
        stage1Generated: expanded.length,
        stage3Passed: 0,
        finalCount: 0,
        adoptedCount: 0,
      },
      candidates: [],
      rejectedCandidates: rejected,
    };
  }

  // Stage 4: DFS SERP Advanced (AI Overview 込み)
  const serpResults = await Promise.all(
    stage3Pass.map((kw) =>
      fetchSerpAdvanced(kw.kw, { includeAiOverview: true }).catch((e) => {
        console.warn(`[stage4 fetchSerpAdvanced] fail for "${kw.kw}":`, e);
        return null;
      }),
    ),
  );

  // Stage 4 で取れた情報を candidate に詰める
  const stage4Candidates: ScoutFinalCandidate[] = stage3Pass.map((kw, i) => {
    const ov = overviewMap.get(kw.kw.toLowerCase());
    const serp = serpResults[i];
    return {
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      kd: ov?.keywordDifficulty ?? null,
      searchVolume: ov?.searchVolume ?? null,
      cpc: ov?.cpc ?? null,
      competition: ov?.competition ?? null,
      competitionLevel: ov?.competitionLevel ?? null,
      searchIntent: ov?.searchIntent ?? null,
      monthlySearches: ov?.monthlySearches ?? [],
      avgBacklinksMain: ov?.avgBacklinksMain ?? null,
      avgBacklinksReferringDomains: ov?.avgBacklinksReferringDomains ?? null,
      serpItemTypes: ov?.serpItemTypes ?? [],
      serpFeatures: serp?.features ?? {
        hasAiOverview: false,
        hasFeaturedSnippet: false,
        hasKnowledgePanel: false,
        hasPaa: false,
        hasShopping: false,
        hasTopStories: false,
        hasVideo: false,
        hasImage: false,
      },
      serpTopUrls: serp?.items.filter((i) => i.type === "organic" && i.url).slice(0, 10).map((i) => i.url!) ?? [],
      aiOverviewReferences: serp?.aiOverviewReferences ?? [],
      paaQuestions: serp?.paaQuestions ?? [],
      // Stage 5 が埋める
      finalScore: 0,
      decision: "borderline",
      rationale: "",
    };
  });

  // Stage 5: Gemini #3  最終判定
  const finalized = await stage5FinalDecision(subject, stage4Candidates, config);

  // 採用優先順位順にソート (finalScore 降順)
  finalized.sort((a, b) => b.finalScore - a.finalScore);

  return {
    subject,
    category,
    stats: {
      stage1Generated: expanded.length,
      stage3Passed: stage3Pass.length,
      finalCount: finalized.length,
      adoptedCount: finalized.filter((c) => c.decision === "adopt").length,
    },
    candidates: finalized,
    rejectedCandidates: rejected,
  };
}
