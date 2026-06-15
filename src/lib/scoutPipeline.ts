import "server-only";
import { gemini, MODELS } from "./gemini";
import { expandKeywords, type ExpandedKeyword, type ScoutCategory } from "./keywordExpander";
import {
  searchVolumeBulk,
  fetchSerpAdvanced,
  relatedKeywords,
  keywordSuggestions,
  searchIntentBulk,
  type KeywordOverviewItem,
  type SerpAdvancedResponse,
} from "./dataforseo";
import { renderTemplate } from "./promptTemplate";
import { calcCvKwScore, extractBrandTokens } from "./cvKw";
import { calcTreasureScore, type TreasureScore } from "./treasureScore";

// =========================================================
// KW スカウト 6段パイプライン (2026-06-15 Backlinks 解約方針確定で KD ステージ撤廃)
// =========================================================
// Stage 0:   DFS    #1  Related Keywords + Keyword Suggestions (シード取得)
// Stage 1:   Gemini #1  KW候補 100件生成 (シードを実検索データとして活用)
// Stage 2:   DFS    #2  Google Ads Search Volume Bulk (SV/CPC/competition)
// Stage 3:   Gemini #2  数値 + 重複/不適切排除で 1次絞り込み
// Stage 3.5: DFS    #3  Search Intent (Google 公式 intent ラベル)
// Stage 4:   DFS    #4  SERP Organic Live Advanced + お宝スコア計算
// Stage 5:   Gemini #3  全情報を見て最終判定 (rationale 強制出力)
//
// 2026-06-10 旧8段から KD ステージを撤廃 (Backlinks 未契約で KD=0/null)。
// 2026-06-11 Stage 0 を追加。Gemini のハルシ抑制とロングテール KW 発掘を狙う。
// 2026-06-14 Backlinks 契約 (Active trial) により Stage 2.5 (KD取得) を一時的に再導入。
// 2026-06-15 実証検証で DFS 日本語ロングテール KW のカバレッジ薄を確認、
//            Backlinks 本契約見送り決定 → Stage 2.5 を撤廃 (6段に戻す)。
//            将来 Backlinks 再開 or Ahrefs 導入時は git 履歴 (2026-06-14 commit) を参照。
// =========================================================

// ---------- 公開型 ----------

export type ScoutDecision = "adopt" | "borderline" | "reject";

export type ScoutFinalCandidate = {
  kw: string;
  // Stage 1 由来 (Gemini #1 が付けた intent + 選定理由)
  intent: ExpandedKeyword["intent"];
  reason: string;

  // Stage 2 由来 (DFS Keyword Overview)
  // 2026-06-15: kd フィールドは型互換用に残すが、現状パイプラインでは常に null
  // (DFS Backlinks 解約方針確定により Stage 2.5 撤廃)。
  kd: number | null;
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

  // 強化 (2026-06-11 A+B+C 統合)
  googleIntent: string | null;       // A: Google 公式の検索意図 (commercial/informational/navigational/transactional)
  googleIntentProb: number | null;   // intent の確信度 (0-1)
  // CVKW (Conversion Keyword) 評価 (2026-06-13 追加)
  cvKwScore: number;                 // 0-100 (Google intent + CV トークン + 商標含有)
  cvKwHits: { strong?: string; mid?: string; brand?: string }; // どの語が当たったか
  // お宝スコア (2026-06-15 追加) — KD/SV/CVKW/SERP 個人ブログ含有の複合指標
  treasureScore: TreasureScore;
  peakMonths: number[];              // B: 過去12ヶ月でSVが平均より20%以上高い月 (1-12)
  troughMonths: number[];            // B: 同じく低い月
  topPageStructures: Array<{         // C: Top3 ページの概要 (SERP の title + snippet)
    url: string;
    domain: string | null;
    rank: number;                    // SERP 順位 (1-3)
    title: string | null;            // SERP に出るタイトル
    description: string | null;      // SERP に出るスニペット文
  }>;

  // Stage 5 由来 (Gemini #3 最終判定)
  finalScore: number;         // 0-100
  decision: ScoutDecision;
  rationale: string;          // 採用/却下の根拠 (必須出力)
};

export type ScoutStageStats = {
  stage0SeedCount?: number;   // Stage 0: DFS Related/Suggestions の合算 (ユニーク数)
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
    searchVolume: number | null;
    cpc: number | null;
    googleIntent: string | null;   // A: Google 公式 intent
    cvKwScore: number;             // CVKW 総合スコア (0-100)
    treasureTotal: number;         // お宝スコア合計 (0-70)
    treasureRank: string;          // "treasure3" | "treasure2" | "treasure1" | "normal"
    peakMonths: number[];          // B: SV ピーク月 (1-12)
    troughMonths: number[];        // B: SV 谷月
    serpFeatures: SerpAdvancedResponse["features"];
    paaSample: string[];           // 上位3つだけ
    aiOverviewDomains: string[];   // AI Overview に引用されているドメイン
    serpTopDomains: string[];      // 上位10件のドメイン
    topPagesSummary: string[];     // C: Top3 ページ構造の要約 (domain + h2Count + wordCount)
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
商品「${subject}」のキーワード候補について、すべての Google 実データを見て採用判定してください。

【最重要: お宝スコア順に採用判定する】
このプロジェクトは「お宝KW (= SEOで個人ブログでも勝てる + 流入が取れる KW) を1スカウト最低1件発掘する」のが目的。
お宝スコア (treasureTotal, 0-70) はそれを機械的に算出した複合指標です:
  - SV ≥1000 で +20〜30点 (流入ボリューム)
  - CVKW × 0.2 で +最大20点 (購入意図)
  - SERP Top10 に個人ブログ含有で +5〜15点 (実勝率の証拠)
  - AI Overview に個人サイト引用で +5点 (LLMOボーナス)

【判定ルール (お宝スコア最優先)】
- adopt: treasureTotal >= 35 (💎💎 お宝以上)
        ※ お宝スコア35以上なら、Top3 が大手でも切り口次第で勝てるので必ず採用
        ※ Top3 ページの「切り口」 を見て、自分が違う角度 (体験談/写真/別ターゲット等) で書けるなら強加点
- borderline: treasureTotal 25-34 (💎 準お宝) — Top10 の状況で判断
        ※ Top10 に個人ブログが多ければ adopt 寄り、大手寡占なら reject 寄り
- reject: treasureTotal < 25 — 通常採用、CVKW < 30 かつ Top10 大手独占の場合のみ

【保証ルール: 最低1件は adopt にする】
候補全体で treasureTotal の最大が 25 以上なら、最低 1件は adopt にする (お宝発掘がこのスカウトの本質目的)。
ただし全候補が treasureTotal < 25 ならハズレ回として全件 reject も可 (ハズレを認める)。

【SERP の中身判断 (KD が無いので最重要)】
- Top10 に個人ブログ (note.com / hatenablog.com / ameblo.jp / livedoor.blog / 等) が 2件以上なら勝てる可能性高い
- Top3 が大手だけでも、切り口 (体験談/写真/別ターゲット) で差別化できれば adopt 可
- 逆に Top10 が ECモール (amazon/rakuten) + 公式サイトばかりなら個人ブログでは勝ち目薄

【候補】
${candidates
  .map(
    (c, idx) =>
      `${idx + 1}. ${c.kw}
   ✨ 💎 お宝スコア=${c.treasureTotal}/70 (rank=${c.treasureRank})
   📊 SV=${c.searchVolume ?? "?"}, CPC=${cpcJpy(c.cpc)}
   💰 CVスコア=${c.cvKwScore}/100 (intent=${c.googleIntent ?? "?"})
   季節性: ${c.peakMonths.length > 0 ? `ピーク=${c.peakMonths.join("/")}月` : "平坦"}${c.troughMonths.length > 0 ? `, 谷=${c.troughMonths.join("/")}月` : ""}
   SERP features: ${Object.entries(c.serpFeatures).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}
   Top10 domains: ${c.serpTopDomains.slice(0, 10).join(", ") || "(none)"}
   AI Overview引用: ${c.aiOverviewDomains.join(", ") || "(none)"}
   PAA: ${c.paaSample.join(" / ") || "(none)"}
   Top3 ページ構造: ${c.topPagesSummary.length > 0 ? c.topPagesSummary.join(" / ") : "(取得失敗)"}`,
  )
  .join("\n\n")}

【出力 (JSONのみ、フェンス禁止)】
{
  "decisions": [
    {
      "kw": "対象KW",
      "finalScore": 75,
      "decision": "adopt",
      "rationale": "お宝スコア42(💎💎お宝)。SV=1200で流入見込み+CVKW=70で購入意図強い+Top10に個人ブログ3件あり実勝率の証拠あり。Top3は価格比較メインだが、自分は体験談で差別化可能。"
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
          `${idx + 1}. ${c.kw} (SV=${c.searchVolume ?? "?"}, CPC=${cpcJpy(c.cpc)})`,
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
      searchVolume: c.searchVolume,
      cpc: c.cpc,
      googleIntent: c.googleIntent,
      cvKwScore: c.cvKwScore,
      treasureTotal: c.treasureScore.total,
      treasureRank: c.treasureScore.rank,
      peakMonths: c.peakMonths,
      troughMonths: c.troughMonths,
      serpFeatures: c.serpFeatures,
      paaSample: c.paaQuestions.slice(0, 3),
      aiOverviewDomains: Array.from(
        new Set(c.aiOverviewReferences.map((r) => r.domain ?? extractDomain(r.url))),
      ).filter(Boolean) as string[],
      serpTopDomains: c.serpTopUrls.map((u) => extractDomain(u) ?? "").filter(Boolean),
      topPagesSummary: c.topPageStructures.map(
        (s) =>
          `[${s.rank}位] ${s.domain ?? "?"}「${s.title ?? "(タイトル不明)"}」`,
      ),
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

// 月別 SV から「平均より20%以上高い月」と「20%以上低い月」を抽出する。
// 季節性のピーク/谷を可視化するため。SV データが少ない (5ヶ月未満) なら空配列。
function calcSeasonality(
  monthlySearches: KeywordOverviewItem["monthlySearches"],
): { peakMonths: number[]; troughMonths: number[] } {
  if (!Array.isArray(monthlySearches) || monthlySearches.length < 5) {
    return { peakMonths: [], troughMonths: [] };
  }
  // 直近12ヶ月だけ使う (それより前は古い)
  const recent = monthlySearches.slice(0, 12);
  const svs = recent.map((m) => m.searchVolume).filter((v): v is number => typeof v === "number" && v > 0);
  if (svs.length === 0) return { peakMonths: [], troughMonths: [] };
  const avg = svs.reduce((a, b) => a + b, 0) / svs.length;
  const peakMonths: number[] = [];
  const troughMonths: number[] = [];
  for (const m of recent) {
    if (typeof m.searchVolume !== "number") continue;
    if (m.searchVolume >= avg * 1.2) peakMonths.push(m.month);
    else if (m.searchVolume <= avg * 0.8) troughMonths.push(m.month);
  }
  return {
    peakMonths: Array.from(new Set(peakMonths)).sort((a, b) => a - b),
    troughMonths: Array.from(new Set(troughMonths)).sort((a, b) => a - b),
  };
}

// ---------- メインエントリ ----------

export async function runScoutPipeline(
  subject: string,
  config: ScoutPipelineConfig = {},
): Promise<ScoutPipelineResult> {
  // Stage 0: DFS Related Keywords + Keyword Suggestions で実検索データのシード KW を取得。
  // 失敗しても先に進む (Gemini #1 単独で動ける)。
  const [related, suggestions] = await Promise.all([
    relatedKeywords(subject, { limit: 50 }).catch((e) => {
      console.warn("[scoutPipeline] Stage0 related failed:", e instanceof Error ? e.message : e);
      return [];
    }),
    keywordSuggestions(subject, { limit: 50 }).catch((e) => {
      console.warn("[scoutPipeline] Stage0 suggestions failed:", e instanceof Error ? e.message : e);
      return [];
    }),
  ]);
  const seedKws = Array.from(new Set([...related, ...suggestions])).slice(0, 100);
  console.log(
    `[scoutPipeline] Stage0 seed: related=${related.length}, suggestions=${suggestions.length}, unique=${seedKws.length}`,
  );

  // Stage 1: Gemini #1  KW候補生成 (シードを実検索データとして活用)
  const { keywords: expanded, category } = await expandKeywords(subject, {
    excludeKws: config.excludeKws,
    maxKeywords: config.kwCandidateCount ?? 100,
    customPrompt: config.promptKwGen,
    seedKeywords: seedKws,
  });

  if (expanded.length === 0) {
    return {
      subject,
      category,
      stats: {
        stage0SeedCount: seedKws.length,
        stage1Generated: 0,
        stage3Passed: 0,
        finalCount: 0,
        adoptedCount: 0,
      },
      candidates: [],
      rejectedCandidates: [],
    };
  }

  // Stage 2: DFS Google Ads Search Volume (bulk対応)
  // SV/CPC/competition のみ取得 (KD は撤廃済 - 2026-06-15)。
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
      kd: null, // Stage 2.5 撤廃済 (2026-06-15)
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
        stage0SeedCount: seedKws.length,
        stage1Generated: expanded.length,
        stage3Passed: 0,
        finalCount: 0,
        adoptedCount: 0,
      },
      candidates: [],
      rejectedCandidates: rejected,
    };
  }

  // Stage 3.5: A. Search Intent — stage3 通過 KW に対して Google 公式 intent を bulk 取得 (~30件)
  const intentItems = await searchIntentBulk(stage3Pass.map((k) => k.kw)).catch((e) => {
    console.warn("[scoutPipeline] Stage3.5 Search Intent failed:", e instanceof Error ? e.message : e);
    return [];
  });
  const intentMap = new Map(
    intentItems.map((it) => [it.kw.toLowerCase(), it] as const),
  );
  console.log(
    `[scoutPipeline] Stage3.5 intent: requested=${stage3Pass.length}, returned=${intentItems.length}`,
  );

  // Stage 4: DFS SERP Advanced (AI Overview 込み)
  // C. 競合 Top3 の中身は SERP レスポンスに含まれる title + snippet で代替。
  //    Content Parsing API は動的サイトで "Page content is empty" 多発のため不採用。
  const serpResults = await Promise.all(
    stage3Pass.map((kw) =>
      fetchSerpAdvanced(kw.kw, { includeAiOverview: true }).catch((e) => {
        console.warn(`[stage4 fetchSerpAdvanced] fail for "${kw.kw}":`, e);
        return null;
      }),
    ),
  );

  // CVKW スコア計算用: subject から商標トークンを抽出
  const brandTokens = extractBrandTokens(subject);

  // Stage 4 で取れた情報を candidate に詰める
  const stage4Candidates: ScoutFinalCandidate[] = stage3Pass.map((kw, i) => {
    const ov = overviewMap.get(kw.kw.toLowerCase());
    const serp = serpResults[i];
    const intent = intentMap.get(kw.kw.toLowerCase());
    const seasonality = calcSeasonality(ov?.monthlySearches ?? []);
    // C. Top3 競合の中身を SERP の organic 上位 3 件の title + snippet で構築
    const top3 = (serp?.items ?? [])
      .filter((it) => it.type === "organic" && it.url)
      .slice(0, 3);
    const topPageStructures = top3.map((it, idx) => ({
      url: it.url!,
      domain: extractDomain(it.url) ?? null,
      rank: idx + 1,
      title: it.title ?? null,
      description: it.description ?? null,
    }));
    // CVKW スコア計算 (Google公式 intent + CV トークン + 商標含有)
    const cv = calcCvKwScore({
      kw: kw.kw,
      googleIntent: intent?.intent ?? null,
      brandTokens,
    });
    // 共通中間値 (KD は撤廃済 - 2026-06-15)
    const svValue = ov?.searchVolume ?? null;
    const serpTopUrls = serp?.items
      .filter((i) => i.type === "organic" && i.url)
      .slice(0, 10)
      .map((i) => i.url!) ?? [];
    const aiOverviewUrls = (serp?.aiOverviewReferences ?? [])
      .map((r) => r.url)
      .filter((u): u is string => !!u);
    // お宝スコア計算 (SV + CVKW + SERP個人ブログ含有 + AI Overview 個人サイト) 最大70点
    const treasureScore = calcTreasureScore({
      searchVolume: svValue,
      cvKwScore: cv.total,
      serpTopUrls,
      aiOverviewUrls,
      subject,
    });
    return {
      kw: kw.kw,
      intent: kw.intent,
      reason: kw.reason,
      kd: null, // 2026-06-15 Stage 2.5 撤廃のため常に null
      searchVolume: svValue,
      cpc: ov?.cpc ?? null,
      competition: ov?.competition ?? null,
      competitionLevel: ov?.competitionLevel ?? null,
      searchIntent: ov?.searchIntent ?? null,
      monthlySearches: ov?.monthlySearches ?? [],
      avgBacklinksMain: ov?.avgBacklinksMain ?? null,
      avgBacklinksReferringDomains: ov?.avgBacklinksReferringDomains ?? null,
      serpItemTypes: ov?.serpItemTypes ?? [],
      // A. Google 公式 intent
      googleIntent: intent?.intent ?? null,
      googleIntentProb: intent?.probability ?? null,
      // CVKW (Conversion Keyword) スコア
      cvKwScore: cv.total,
      cvKwHits: cv.hits,
      // お宝スコア (2026-06-15)
      treasureScore,
      // B. 季節性 (既存 monthlySearches から算出)
      peakMonths: seasonality.peakMonths,
      troughMonths: seasonality.troughMonths,
      // C. Top3 競合 (SERP の title + snippet で構築)
      topPageStructures,
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
      serpTopUrls,
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
      stage0SeedCount: seedKws.length,
      stage1Generated: expanded.length,
      stage3Passed: stage3Pass.length,
      finalCount: finalized.length,
      adoptedCount: finalized.filter((c) => c.decision === "adopt").length,
    },
    candidates: finalized,
    rejectedCandidates: rejected,
  };
}
