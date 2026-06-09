import "server-only";
import { gemini, MODELS } from "./gemini";
import { expandKeywords, type ExpandedKeyword, type ScoutCategory } from "./keywordExpander";
import {
  bulkKeywordDifficulty,
  keywordOverview,
  fetchSerpAdvanced,
  type KeywordOverviewItem,
  type SerpAdvancedResponse,
  type BulkKdItem,
} from "./dataforseo";
import { renderTemplate } from "./promptTemplate";

// =========================================================
// KW スカウト 8段パイプライン (拡張プラン B' / 2026-06-07 MTG決定)
// =========================================================
// Stage 1: Gemini #1  KW候補 100件生成 (商標 + 購入直前KW)
// Stage 2: DFS    #1  Bulk Keyword Difficulty Live (KD 一括取得)
// Stage 3: Gemini #2  KD閾値 + 除外/重複/不適切判定で 1次絞り込み
// Stage 4: DFS    #2  Keyword Overview Live (SV/CPC/Intent/Trend/...)
// Stage 5: Gemini #3  数値閾値 + ジャンル整合性で 2次絞り込み
// Stage 6: DFS    #3  SERP Organic Live Advanced (SERP feature + AI Overview)
// Stage 7: Gemini #4  全情報を見て最終判定 (rationale 強制出力)
// Stage 8: (Stage 6 で AI Overview 同時取得済のため別工程不要)
//
// 設計原則:
// - 各 Gemini ステップは「閾値ベースの明示指示 + rationale 強制」でハルシ抑制
// - mock 対応: DATAFORSEO_USE_MOCK=true で全 DFS 段が mock を返す
// - 設定 (閾値・プロンプト・除外KW) はオプション化、後で設定画面から差替可能
// =========================================================

// ---------- 公開型 ----------

export type ScoutDecision = "adopt" | "borderline" | "reject";

export type ScoutFinalCandidate = {
  kw: string;
  // Stage 1 由来 (Gemini #1 が付けた intent + 選定理由)
  intent: ExpandedKeyword["intent"];
  reason: string;

  // Stage 2/4 由来 (DFS)
  kd: number | null;                // 0-100 (低いほど狙いやすい)
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;       // 0-1
  competitionLevel: string | null;
  searchIntent: string | null;
  monthlySearches: KeywordOverviewItem["monthlySearches"];
  avgBacklinksMain: number | null;
  avgBacklinksReferringDomains: number | null;
  serpItemTypes: string[];

  // Stage 6 由来 (SERP Advanced)
  serpFeatures: SerpAdvancedResponse["features"];
  serpTopUrls: string[];
  aiOverviewReferences: SerpAdvancedResponse["aiOverviewReferences"];
  paaQuestions: string[];

  // Stage 7 由来 (Gemini #4 最終判定)
  finalScore: number;         // 0-100
  decision: ScoutDecision;
  rationale: string;          // 採用/却下の根拠 (必須出力)
};

export type ScoutStageStats = {
  stage1Generated: number;    // Gemini #1 で出した数
  stage3PassedKd: number;     // KD 1次絞り込み通過数
  stage5PassedMetrics: number; // 数値 2次絞り込み通過数
  finalCount: number;          // 最終候補数 (decision 関係なく)
  adoptedCount: number;        // decision="adopt" の数
};

// 各 KW がパイプラインのどこまで進んだかを示すステータス。
// 「100件の母集団のどれが、なぜ落ちたか」を後から見せるため、
// 全 KW について必ず1つ記録する。
export type StageStatus =
  | "stage3_kd_rejected"       // Stage 2 で KD>閾値 で落選
  | "stage3_filter_rejected"   // Stage 3 で Gemini #2 が重複/不適切と判定して落選
  | "stage5_metric_rejected"   // Stage 5 で Gemini #3 が数値で落選
  | "stage7_evaluated";        // Stage 7 まで通過 (decision は別途 candidates 側に入る)

export type ScoutAllCandidate = {
  kw: string;
  intent: ExpandedKeyword["intent"];
  reason: string;
  stage: StageStatus;
  // 取得済みの分だけ入る (落選段階によって埋まる項目が違う)
  kd?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  competitionLevel?: string | null;
  searchIntent?: string | null;
  // 落選理由 (Gemini が文字列で出した場合)
  rejectionNote?: string;
};

export type ScoutPipelineResult = {
  subject: string;
  category: ScoutCategory;
  stats: ScoutStageStats;
  candidates: ScoutFinalCandidate[];
  // Stage 1 で生成された全 KW + 各 KW のパイプライン到達状況。
  // candidates に入っているKWはここには含めない (重複回避、UI 側でマージ表示)。
  rejectedCandidates: ScoutAllCandidate[];
};

export type ScoutPipelineConfig = {
  kwCandidateCount?: number;            // Gemini #1 生成数 (default 100)
  kdMaxStage3?: number;                 // KD <= この値 を通過 (default 30)
  minSvStage5?: number;                 // SV >= この値 を通過 (default 100)
  minCpcStage5?: number;                // CPC >= この値 USD (default 0.2)
  maxFinalCount?: number;               // 最終判定に回すKW数の上限 (default 10)
  excludeKws?: string[];                // 除外KW (プロジェクト単位)
  // 各 Gemini ステップのプロンプト override (関数型 or 文字列テンプレ)
  //   文字列の場合は placeholder ({subject} / {keywords} / {kdThreshold} 等) を
  //   各 stage の input から自動展開して使用する。
  //   関数型の場合はそのまま呼ぶ。
  promptKwGen?: string;                 // Stage1: keywordExpander.customPrompt として渡す
  promptStage3?: string | ((input: Stage3PromptInput) => string);
  promptStage5?: string | ((input: Stage5PromptInput) => string);
  promptFinal?: string | ((input: FinalPromptInput) => string);
};

// ---------- Gemini プロンプト入力 (型) ----------

export type Stage3PromptInput = {
  subject: string;
  keywords: Array<{ kw: string; intent: string; reason: string; kd: number | null }>;
  kdThreshold: number;
};

export type Stage5PromptInput = {
  subject: string;
  category: ScoutCategory;
  keywords: Array<{
    kw: string;
    intent: string;
    kd: number | null;
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
    aiOverviewDomains: string[];  // AI Overview に引用されているドメイン (重複なし)
    serpTopDomains: string[];     // 上位10件のドメイン (重複あり)
  }>;
};

// ---------- 通貨表記ヘルパー ----------
// DataForSEO は CPC を USD で返すので、Gemini プロンプト/UI には円換算して渡す。
// (1 USD = 150円 固定換算。Gemini の rationale 出力に "$" が混じらないように)
const JPY_PER_USD = 150;
function cpcJpy(cpcUsd: number | null | undefined): string {
  if (cpcUsd === null || cpcUsd === undefined) return "?";
  return `¥${Math.round(cpcUsd * JPY_PER_USD)}`;
}

// ---------- デフォルト Gemini プロンプト ----------

function defaultStage3Prompt(i: Stage3PromptInput): string {
  return `
あなたはアフィリエイトSEOの編集者です。以下のお題「${i.subject}」に対して候補KW群があります。
各KWには Keyword Difficulty (KD: 0-100, 低いほど狙いやすい) が付与されています。

# あなたの役割
以下の判定基準で「次段の精査に進めるKW」を選んでください。

# 判定基準
1. KD <= ${i.kdThreshold} のものを残す (厳守)
2. 上記をクリアした中から、以下のものを **除外** する:
   - 明らかな重複・同義語 (例: "○○ 価格" と "○○ 値段")
   - スパム的・不適切・低品質と判断できるKW
   - お題の商材から外れすぎているKW

# 候補KW群
${i.keywords
  .map((k, idx) => `${idx + 1}. kw="${k.kw}", intent=${k.intent}, kd=${k.kd ?? "?"}, 選定理由=${k.reason}`)
  .join("\n")}

# 出力 (JSONのみ、フェンス禁止)
{
  "selected": ["残すKWの文字列1", "残すKWの文字列2", ...],
  "excluded": [{"kw": "除外したKW", "reason": "なぜ除外したかの根拠"}, ...]
}
`.trim();
}

function defaultStage5Prompt(i: Stage5PromptInput): string {
  return `
あなたはアフィリエイトSEOの編集者です。お題「${i.subject}」(カテゴリ: ${i.category})。
DFS Keyword Overview から取得した客観指標を見て、最終 SERP 精査に回すKWを最大 ${i.maxFinalCount} 件 選んでください。

# 判定基準 (閾値はガイドライン。柔軟に判断OK)
- SV >= ${i.minSv} (検索ボリュームが少なすぎるKWは除外)
- CPC >= ¥${Math.round(i.minCpc * JPY_PER_USD)} (CV見込みが薄いKWは優先度低、円換算)
- searchIntent (DFS判定) が commercial/transactional のものは優先度高
- KD と SV のバランス: KD低 × SV中 が理想
- お題のカテゴリと意味的に整合するKWを優先

# 候補KW群
${i.keywords
  .map(
    (k, idx) =>
      `${idx + 1}. kw="${k.kw}" (intent_gemini=${k.intent}, intent_dfs=${k.searchIntent ?? "?"}, kd=${k.kd ?? "?"}, sv=${k.searchVolume ?? "?"}, cpc=${cpcJpy(k.cpc)}, competition=${k.competitionLevel ?? "?"})`,
  )
  .join("\n")}

# 出力 (JSONのみ)
{
  "selected": ["残すKW1", ...],
  "rationale": "なぜこれらを選んだかの全体方針 (50-150文字)"
}
`.trim();
}

function defaultFinalPrompt(i: FinalPromptInput): string {
  return `
あなたはアフィリエイトSEOの編集者です。お題「${i.subject}」に対する最終候補KW群を SERP 精査結果込みで判定してください。

各KWに対して以下3つを必ず出力:
1. finalScore (0-100): 採用優先度 (KD低 × SV中以上 × intent合致 × 競合適度 を総合)
2. decision: "adopt" (積極採用) | "borderline" (要検討) | "reject" (却下)
3. rationale: 「どの数値・どの SERP feature を見て、なぜこの判定か」を 80-200文字で具体記述。
   抽象的な「中程度です」だけはNG。具体的な数値・ドメイン名・feature名を含めること。

# SERP feature の見方 (参考)
- hasAiOverview: Gemini AI Overview に引用される可能性が示唆される
- hasFeaturedSnippet: 0位を取れれば flag-poll
- hasKnowledgePanel: Wikipedia/公式が強い → 個人ブログ厳しい
- hasShopping/hasTopStories: 商品ページ/ニュース寄り → ブログの居場所変わる
- hasPaa: 質問解説型コンテンツに優位

# 候補
${i.candidates
  .map(
    (c, idx) => `
${idx + 1}. kw="${c.kw}"
   数値: kd=${c.kd ?? "?"}, sv=${c.searchVolume ?? "?"}, cpc=${cpcJpy(c.cpc)}
   SERP features: ${Object.entries(c.serpFeatures).filter(([, v]) => v).map(([k]) => k).join(", ") || "なし"}
   上位ドメイン (10件): ${c.serpTopDomains.join(", ") || "なし"}
   AI Overview引用ドメイン: ${c.aiOverviewDomains.join(", ") || "なし"}
   PAA質問例: ${c.paaSample.slice(0, 3).join(" / ") || "なし"}
`,
  )
  .join("\n")}

# 出力 (JSONのみ、フェンス禁止)
{
  "decisions": [
    {
      "kw": "対象KW",
      "finalScore": 75,
      "decision": "adopt",
      "rationale": "kd=18と低く、sv=1200で需要十分、上位10件中6件が個人ブログでDR低め。AI Overview引用元にgigazine.netが入っており解説需要あり。"
    }
  ]
}
`.trim();
}

// ---------- プロンプトテンプレ展開ヘルパー ----------

// Stage 3 input → placeholder vars
function stage3Vars(i: Stage3PromptInput): Record<string, string | number> {
  return {
    subject: i.subject,
    kdThreshold: i.kdThreshold,
    keywords: i.keywords
      .map(
        (k, idx) =>
          `${idx + 1}. kw="${k.kw}", intent=${k.intent}, kd=${k.kd ?? "?"}, 理由=${k.reason}`,
      )
      .join("\n"),
  };
}

// Stage 5 input → placeholder vars
function stage5Vars(i: Stage5PromptInput): Record<string, string | number> {
  return {
    subject: i.subject,
    category: i.category,
    minSv: i.minSv,
    minCpc: i.minCpc,
    maxFinalCount: i.maxFinalCount,
    keywords: i.keywords
      .map(
        (k, idx) =>
          `${idx + 1}. kw="${k.kw}" (intent_gemini=${k.intent}, intent_dfs=${k.searchIntent ?? "?"}, kd=${k.kd ?? "?"}, sv=${k.searchVolume ?? "?"}, cpc=${cpcJpy(k.cpc)}, competition=${k.competitionLevel ?? "?"})`,
      )
      .join("\n"),
  };
}

// Final input → placeholder vars
function finalVars(i: FinalPromptInput): Record<string, string | number> {
  return {
    subject: i.subject,
    candidates: i.candidates
      .map(
        (c, idx) => `
${idx + 1}. kw="${c.kw}"
   数値: kd=${c.kd ?? "?"}, sv=${c.searchVolume ?? "?"}, cpc=${cpcJpy(c.cpc)}
   SERP features: ${Object.entries(c.serpFeatures).filter(([, v]) => v).map(([k]) => k).join(", ") || "なし"}
   上位ドメイン (10件): ${c.serpTopDomains.join(", ") || "なし"}
   AI Overview引用ドメイン: ${c.aiOverviewDomains.join(", ") || "なし"}
   PAA質問例: ${c.paaSample.slice(0, 3).join(" / ") || "なし"}
`,
      )
      .join("\n"),
  };
}

/**
 * config.prompt* に「文字列 or 関数」が渡ったら統一的に「関数」として扱う。
 * 文字列の場合は renderTemplate で展開し、デフォルト出力フォーマット指示 (JSON) を
 * 末尾に必ず append する (パース壊れ防止)。
 */
function resolveStagePrompt<TInput>(
  override: string | ((input: TInput) => string) | undefined,
  defaultFn: (input: TInput) => string,
  toVars: (input: TInput) => Record<string, string | number>,
  outputFooter: string,
): (input: TInput) => string {
  if (!override) return defaultFn;
  if (typeof override === "function") return override;
  // 文字列テンプレ: placeholder 展開 + 出力フォーマット指示 footer を必ず追記
  return (input: TInput) => {
    const rendered = renderTemplate(override, toVars(input));
    return `${rendered}\n\n${outputFooter}`;
  };
}

const STAGE3_FOOTER = `# 出力 (JSONのみ、フェンス禁止)
{
  "selected": ["残すKWの文字列1", "残すKWの文字列2", ...],
  "excluded": [{"kw": "除外したKW", "reason": "なぜ除外したかの根拠"}, ...]
}`;

const STAGE5_FOOTER = `# 出力 (JSONのみ)
{
  "selected": ["残すKW1", ...],
  "rationale": "なぜこれらを選んだかの全体方針 (50-150文字)"
}`;

const FINAL_FOOTER = `# 出力 (JSONのみ、フェンス禁止)
{
  "decisions": [
    {
      "kw": "対象KW",
      "finalScore": 75,
      "decision": "adopt",
      "rationale": "kd=18と低く、sv=1200で需要十分、上位10件中6件が個人ブログでDR低め。AI Overview引用元にgigazine.netが入っており解説需要あり。"
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
    // 空応答 (safety block / quota / 0 token return)
    const finishReason = res.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini returned empty response (finishReason=${finishReason})`);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    // Truncation 救出: maxOutputTokens 到達で末尾が切れたケース。
    // ] や } を補完して再 parse 試行。
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as T;
        console.warn(`[callGeminiJson] recovered from truncation. original len=${cleaned.length}`);
        return parsed;
      } catch {
        // 再失敗 → 元のエラーを投げる
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

// 末尾が切れた JSON を補修 (閉じ括弧の数合わせ + 末尾の不完全要素を捨てる)。
// 完全な復元はできないが「decisions の途中まで」を取り出せれば十分。
function repairTruncatedJson(s: string): string | null {
  // 末尾のカンマ/不完全フィールドを切り捨てる: 最後の "}" 以降を削除
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace < 0) return null;
  let trimmed = s.slice(0, lastBrace + 1);
  // 閉じ括弧の数合わせ
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

async function stage3FilterByKd(
  subject: string,
  expanded: ExpandedKeyword[],
  kdItems: BulkKdItem[],
  config: ScoutPipelineConfig,
): Promise<ExpandedKeyword[]> {
  const kdThreshold = config.kdMaxStage3 ?? 30;
  // KD 取得失敗時は安全側に通過 (kd=null は閾値判定で通す)
  const kdMap = new Map(kdItems.map((k) => [k.kw, k.kd]));
  const withinThreshold = expanded.filter((kw) => {
    const kd = kdMap.get(kw.kw);
    return kd === null || kd === undefined || kd <= kdThreshold;
  });

  // 閾値内が 0 件なら早期 return
  if (withinThreshold.length === 0) return [];

  // Gemini で重複/不適切排除
  const promptInput: Stage3PromptInput = {
    subject,
    keywords: withinThreshold.map((kw) => ({
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      kd: kdMap.get(kw.kw) ?? null,
    })),
    kdThreshold,
  };
  const promptFn = resolveStagePrompt(
    config.promptStage3,
    defaultStage3Prompt,
    stage3Vars,
    STAGE3_FOOTER,
  );
  const prompt = promptFn(promptInput);

  try {
    const result = await callGeminiJson<{ selected: string[]; excluded?: unknown }>(
      prompt,
      {
        type: "object",
        properties: {
          selected: { type: "array", items: { type: "string" } },
          excluded: { type: "array" },
        },
        required: ["selected"],
      },
      12000,
    );
    const selectedSet = new Set(result.selected.map((s) => s.toLowerCase()));
    return withinThreshold.filter((kw) => selectedSet.has(kw.kw.toLowerCase()));
  } catch (e) {
    console.warn(`[stage3FilterByKd] Gemini failed, fallback to KD-only filter:`, e);
    return withinThreshold;
  }
}

async function stage5FilterByMetrics(
  subject: string,
  category: ScoutCategory,
  stage3Pass: ExpandedKeyword[],
  overviewItems: KeywordOverviewItem[],
  config: ScoutPipelineConfig,
): Promise<ExpandedKeyword[]> {
  const minSv = config.minSvStage5 ?? 100;
  const minCpc = config.minCpcStage5 ?? 0.2;
  const maxFinalCount = config.maxFinalCount ?? 10;

  const overviewMap = new Map(overviewItems.map((o) => [o.kw, o]));

  const promptInput: Stage5PromptInput = {
    subject,
    category,
    keywords: stage3Pass.map((kw) => {
      const ov = overviewMap.get(kw.kw);
      return {
        kw: kw.kw,
        intent: kw.intent,
        kd: ov?.keywordDifficulty ?? null,
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
    config.promptStage5,
    defaultStage5Prompt,
    stage5Vars,
    STAGE5_FOOTER,
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
      4000,
    );
    const selectedSet = new Set(result.selected.map((s) => s.toLowerCase()));
    return stage3Pass.filter((kw) => selectedSet.has(kw.kw.toLowerCase())).slice(0, maxFinalCount);
  } catch (e) {
    console.warn(`[stage5FilterByMetrics] Gemini failed, fallback to threshold-only:`, e);
    // フォールバック: SV/CPC で機械絞り → 先頭 maxFinalCount
    return stage3Pass
      .filter((kw) => {
        const ov = overviewMap.get(kw.kw);
        const sv = ov?.searchVolume ?? 0;
        const cpc = ov?.cpc ?? 0;
        return sv >= minSv && cpc >= minCpc;
      })
      .slice(0, maxFinalCount);
  }
}

async function stage7FinalDecision(
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
        // Gemini が判定を返さなかった場合は borderline + 50点
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
    console.warn(`[stage7FinalDecision] Gemini failed, mark all as borderline:`, e);
    return candidates.map((c) => ({
      ...c,
      finalScore: 50,
      decision: "borderline" as const,
      rationale: `(AI判定失敗: ${e instanceof Error ? e.message : "unknown"})`,
    }));
  }
}

// ---------- ユーティリティ ----------

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
      stats: { stage1Generated: 0, stage3PassedKd: 0, stage5PassedMetrics: 0, finalCount: 0, adoptedCount: 0 },
      candidates: [],
      rejectedCandidates: [],
    };
  }

  // Stage 2: DFS #1  Bulk Keyword Difficulty
  const kdItems = await bulkKeywordDifficulty(expanded.map((k) => k.kw));
  const kdMap = new Map(kdItems.map((k) => [k.kw, k.kd]));

  // Stage 3: Gemini #2  KD閾値 + 重複除外
  const stage3Pass = await stage3FilterByKd(subject, expanded, kdItems, config);
  const stage3PassSet = new Set(stage3Pass.map((k) => k.kw));

  // Stage 3 で落選した KW を rejectedCandidates に追加
  const rejected: ScoutAllCandidate[] = [];
  const kdThreshold = config.kdMaxStage3 ?? 30;
  for (const kw of expanded) {
    if (stage3PassSet.has(kw.kw)) continue;
    const kd = kdMap.get(kw.kw) ?? null;
    const overKd = kd !== null && kd > kdThreshold;
    rejected.push({
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      stage: overKd ? "stage3_kd_rejected" : "stage3_filter_rejected",
      kd,
      rejectionNote: overKd
        ? `KD=${kd} が閾値 ${kdThreshold} を超過`
        : "Gemini #2 が重複/不適切と判定して除外",
    });
  }

  if (stage3Pass.length === 0) {
    return {
      subject,
      category,
      stats: {
        stage1Generated: expanded.length,
        stage3PassedKd: 0,
        stage5PassedMetrics: 0,
        finalCount: 0,
        adoptedCount: 0,
      },
      candidates: [],
      rejectedCandidates: rejected,
    };
  }

  // Stage 4: DFS #2  Keyword Overview
  const overviewItems = await keywordOverview(stage3Pass.map((k) => k.kw));
  const overviewMap = new Map(overviewItems.map((o) => [o.kw, o]));

  // Stage 5: Gemini #3  数値ベース 2次絞り込み
  const stage5Pass = await stage5FilterByMetrics(subject, category, stage3Pass, overviewItems, config);
  const stage5PassSet = new Set(stage5Pass.map((k) => k.kw));

  // Stage 5 で落選した KW を rejectedCandidates に追加
  for (const kw of stage3Pass) {
    if (stage5PassSet.has(kw.kw)) continue;
    const ov = overviewMap.get(kw.kw);
    rejected.push({
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      stage: "stage5_metric_rejected",
      kd: ov?.keywordDifficulty ?? kdMap.get(kw.kw) ?? null,
      searchVolume: ov?.searchVolume ?? null,
      cpc: ov?.cpc ?? null,
      competitionLevel: ov?.competitionLevel ?? null,
      searchIntent: ov?.searchIntent ?? null,
      rejectionNote: "Gemini #3 が SV/CPC/intent から優先度低と判定",
    });
  }

  if (stage5Pass.length === 0) {
    return {
      subject,
      category,
      stats: {
        stage1Generated: expanded.length,
        stage3PassedKd: stage3Pass.length,
        stage5PassedMetrics: 0,
        finalCount: 0,
        adoptedCount: 0,
      },
      candidates: [],
      rejectedCandidates: rejected,
    };
  }

  // Stage 6: DFS #3  SERP Advanced (AI Overview 込み)
  // (overviewMap / kdMap は Stage 3/5 で既に作成済み、ここでは再利用)

  const serpResults = await Promise.all(
    stage5Pass.map((kw) =>
      fetchSerpAdvanced(kw.kw, { includeAiOverview: true }).catch((e) => {
        console.warn(`[stage6 fetchSerpAdvanced] fail for "${kw.kw}":`, e);
        return null;
      }),
    ),
  );

  // Stage 6 で取れた情報を candidate に詰める (Stage 7 はこの上で判定)
  const stage6Candidates: ScoutFinalCandidate[] = stage5Pass.map((kw, i) => {
    const ov = overviewMap.get(kw.kw);
    const serp = serpResults[i];
    return {
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      kd: ov?.keywordDifficulty ?? kdMap.get(kw.kw) ?? null,
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
      // Stage 7 が埋める
      finalScore: 0,
      decision: "borderline",
      rationale: "",
    };
  });

  // Stage 7: Gemini #4  最終判定
  const finalized = await stage7FinalDecision(subject, stage6Candidates, config);

  // 採用優先順位順にソート (finalScore 降順)
  finalized.sort((a, b) => b.finalScore - a.finalScore);

  return {
    subject,
    category,
    stats: {
      stage1Generated: expanded.length,
      stage3PassedKd: stage3Pass.length,
      stage5PassedMetrics: stage5Pass.length,
      finalCount: finalized.length,
      adoptedCount: finalized.filter((c) => c.decision === "adopt").length,
    },
    candidates: finalized,
    rejectedCandidates: rejected,
  };
}
