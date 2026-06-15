"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";
import { useGeneration } from "@/components/GenerationProvider";
import { getCache, setCache } from "@/lib/clientCache";
import type { Article, FeedIdea, FeedState } from "@/lib/types";
import {
  PLATFORM_LABELS,
  getPlatformFaviconUrl,
  type Platform,
} from "@/lib/posters/types";
import ScoutConfigTab from "../settings/ScoutConfigTab";

const CACHE_SUBJECT = "products:subject";
const CACHE_RESULT = "products:result";
const CACHE_IDEIZED = "products:ideized";

type DestinationStatus = {
  destinationId: string;
  platform: string;
  label: string;
  platformLabel: string;
  occupied: boolean;     // true = 既に競合記事あり / false = 未投稿の隙間
  hits: number;          // 上位10件中の該当 platform 記事数
  promptReady?: boolean; // true = プロンプト設定済で記事生成可 / false = プロンプト未設定
};

// 5段パイプライン出力に対応 (2026-06-10 リファクタ)。
// 旧フィールド (seoDifficulty 等) は履歴の後方互換のため optional 残置。
type ScoutCandidate = {
  kw: string;
  intent: string;
  reason: string;

  // DFS Bulk KD + Keyword Overview から (P2 で追加)
  kd?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  competitionLevel?: string | null;
  searchIntent?: string | null;
  monthlySearches?: Array<{ year: number; month: number; searchVolume: number }>;
  avgBacklinksMain?: number | null;
  avgBacklinksReferringDomains?: number | null;
  serpItemTypes?: string[];

  // DFS SERP Advanced から
  serpFeatures?: {
    hasAiOverview: boolean;
    hasFeaturedSnippet: boolean;
    hasKnowledgePanel: boolean;
    hasPaa: boolean;
    hasShopping: boolean;
    hasTopStories: boolean;
    hasVideo: boolean;
    hasImage: boolean;
  };
  serpTopUrls?: string[];
  aiOverviewReferences?: Array<{ url: string; title?: string; domain?: string; source?: string }>;
  paaQuestions?: string[];

  // 2026-06-11 A+B+C 統合で追加 (optional: 旧履歴互換)
  googleIntent?: string | null;       // A: Google 公式 intent
  googleIntentProb?: number | null;
  // 2026-06-13 CVKW 評価追加 (optional)
  cvKwScore?: number;                 // 0-100 (購入意図の強さ)
  cvKwHits?: { strong?: string; mid?: string; brand?: string };
  // 2026-06-15 お宝スコア追加 (optional: 旧履歴互換)
  treasureScore?: {
    total: number;        // 0-110
    rank: "treasure3" | "treasure2" | "treasure1" | "normal";
    breakdown: {
      kd:         { value: number | string | null; points: number; reason: string };
      sv:         { value: number | string | null; points: number; reason: string };
      cvKw:       { value: number | string | null; points: number; reason: string };
      serp:       { value: number | string | null; points: number; reason: string };
      aiOverview: { value: number | string | null; points: number; reason: string };
    };
  };
  peakMonths?: number[];               // B: SV ピーク月
  troughMonths?: number[];             // B: SV 谷月
  topPageStructures?: Array<{          // C: Top3 競合の SERP 概要 (タイトル + スニペット)
    url: string;
    domain: string | null;
    rank?: number;                     // SERP 順位
    title: string | null;
    description?: string | null;       // SERP のスニペット
    // 旧フィールド (Content Parsing 時代の履歴互換、廃止)
    h2Count?: number;
    h2Sample?: string[];
    wordCount?: number | null;
  }>;

  // Gemini #3 最終判定
  finalScore?: number;
  decision?: "adopt" | "borderline" | "reject";

  // 既存フィールド (旧履歴互換 / destination 表示用)
  rationale?: string;
  seoDifficulty?: "easy" | "medium" | "hard";
  opportunityScore?: number;
  buckets?: {
    big_ec: number;
    big_media: number;
    individual_blog: number;
    other: number;
  };
  totalScanned?: number;
  topUrls?: string[];
  platformOccupancy?: Record<string, number>;
  destinationStatus?: DestinationStatus[];
};

type ScoutStats = {
  stage0SeedCount?: number;
  stage1Generated: number;
  stage3Passed: number;
  finalCount: number;
  adoptedCount: number;
};

// Stage 1 で生成されたが Stage 3 で落選した KW (落選理由付き)
type RejectedCandidate = {
  kw: string;
  intent: string;
  reason: string;
  stage: "stage2_5_kd_rejected" | "stage3_rejected" | "stage5_evaluated";
  kd?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  competitionLevel?: string | null;
  searchIntent?: string | null;
  rejectionNote?: string;
};

type ScoutResponse = {
  subject: string;
  candidateCount: number;
  candidates: ScoutCandidate[];
  rejectedCandidates?: RejectedCandidate[];
  stats?: ScoutStats;
  historyId?: string;
};

type HistoryItem = {
  id: string;
  subject: string;
  category: string | null;
  candidate_count: number;
  created_at: string;
};

// 旧履歴互換用バッジ (新パイプラインでは seoDifficulty 自体が無いので decision バッジを使う)
const DIFF_BADGE: Record<"easy" | "medium" | "hard", { text: string; cls: string }> = {
  easy: { text: "◎ 易", cls: "bg-green-100 text-green-700" },
  medium: { text: "△ 中", cls: "bg-yellow-100 text-yellow-700" },
  hard: { text: "✕ 難", cls: "bg-red-100 text-red-700" },
};

const INTENT_LABEL: Record<string, string> = {
  info: "情報",
  "how-to": "やり方",
  comparison: "比較",
  trouble: "悩み",
  review: "レビュー",
  purchase: "購入意欲",
};

export default function ProductsClient() {
  const searchParams = useSearchParams();
  const { enqueue } = useGeneration();
  // 初期値を clientCache から復元 (ページ間遷移してもスカウト結果が消えないように)
  const [subject, setSubject] = useState<string>(() => getCache<string>(CACHE_SUBJECT) ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScoutResponse | null>(
    () => getCache<ScoutResponse>(CACHE_RESULT) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [ideized, setIdeized] = useState<Set<string>>(
    () => new Set(getCache<string[]>(CACHE_IDEIZED) ?? []),
  );
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  // タブ: 新規スカウト / 履歴一覧 / 保留KW (ネタ化のみ実行された未記事化 KW)
  const [tab, setTab] = useState<"new" | "history" | "adopted" | "pending" | "config">("new");
  // 保留KW タブ用
  const [pendingIdeas, setPendingIdeas] = useState<FeedIdea[]>([]);
  const [pendingArticles, setPendingArticles] = useState<Article[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [generatingFromPending, setGeneratingFromPending] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  // 履歴ジャンルフィルタ ("" = すべて表示)
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<string>("");
  const [backfilling, setBackfilling] = useState(false);
  // Ahrefs 精査結果 (KWごと)
  const [ahrefsMetrics, setAhrefsMetrics] = useState<
    Record<string, { kd: number | null; vol: number | null; cpc: number | null }>
  >({});
  const [refining, setRefining] = useState<Set<string>>(new Set());
  // パイプライン段階タブ (① Gemini #1 100件 / ② Stage3 Gemini #2 通過 / ③ Stage5 最終採用)
  // デフォルトは ③ (採用候補リスト)
  const [pipelineStage, setPipelineStage] = useState<1 | 3 | 5>(5);

  // ベストセラー画面 → 「この商品でスカウト」遷移時に q クエリで subject 上書き
  useEffect(() => {
    const q = searchParams?.get("q");
    if (q) {
      setSubject(q);
      setCache(CACHE_SUBJECT, q);
    }
  }, [searchParams]);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/products/scout/history?limit=20");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history ?? []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  // 初回マウントで履歴ロード
  useEffect(() => {
    refreshHistory();
  }, []);

  // 履歴 / 保留KW タブ時のみ body のスクロールを止める
  useEffect(() => {
    if (tab !== "history" && tab !== "pending" && tab !== "adopted") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [tab]);

  // 保留KW タブ表示時に feed.ideas + articles をロード
  const loadPending = async () => {
    setPendingLoading(true);
    try {
      const [feedRes, articlesRes] = await Promise.all([
        fetch("/api/feed", { cache: "no-store" }),
        fetch("/api/articles", { cache: "no-store" }),
      ]);
      const feedData = (await feedRes.json()) as FeedState;
      const articlesData = (await articlesRes.json()) as { articles: Article[] };
      setPendingIdeas(feedData.ideas ?? []);
      setPendingArticles(articlesData.articles ?? []);
    } finally {
      setPendingLoading(false);
    }
  };
  useEffect(() => {
    if (tab !== "pending") return;
    loadPending();
  }, [tab]);

  // タブ未表示でも GroupTab に (件数) を出したいので、初回マウント時に1回だけロード
  useEffect(() => {
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GroupTab 表示用: scout 由来 (customLabel "🛒 *") かつまだ記事化されていない idea 数
  const pendingCount = useMemo(() => {
    const adoptedIdeaIds = new Set(
      pendingArticles
        .map((a) => (a.idea as FeedIdea)?.id)
        .filter((x): x is string => !!x),
    );
    return pendingIdeas.filter(
      (i) => i.customLabel?.startsWith("🛒") && !adoptedIdeaIds.has(i.id),
    ).length;
  }, [pendingIdeas, pendingArticles]);

  // 採用KW タブ用: scout 由来 (idea.customLabel "🛒 *") の article 一覧
  // (ライブラリから 2026-06-09 に移動)
  const adoptedArticles = useMemo<Article[]>(() => {
    return pendingArticles.filter((a) => {
      const cl = (a.idea as FeedIdea)?.customLabel?.trim();
      return cl?.startsWith("🛒") ?? false;
    });
  }, [pendingArticles]);
  const adoptedCount = adoptedArticles.length;

  // 採用KWタブ用 destinations (platform バッジ表示用)
  const [destinationsForAdopted, setDestinationsForAdopted] = useState<
    { id: string; platform: string; label: string }[]
  >([]);
  useEffect(() => {
    if (tab !== "adopted") return;
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((d) => setDestinationsForAdopted(d.destinations ?? []))
      .catch(() => {});
  }, [tab]);

  // 保留KW から記事生成キュー投入
  async function generateFromPendingIdea(idea: FeedIdea) {
    setGeneratingFromPending((s) => new Set([...s, idea.id]));
    try {
      enqueue([idea]);
      // ローカル state からは消しておく (記事化されたら articles 側に出るが、即座に反映)
      setPendingArticles((prev) => prev); // no-op; pendingIdeas をフィルタしてはいけない (失敗時に戻せない)
    } finally {
      setGeneratingFromPending((s) => {
        const n = new Set(s);
        n.delete(idea.id);
        return n;
      });
    }
  }

  // 保留KW から破棄
  async function dismissPendingIdea(idea: FeedIdea) {
    if (!confirm(`「${idea.title}」を保留KWから外しますか?`)) return;
    setDismissing((s) => new Set([...s, idea.id]));
    try {
      const res = await fetch("/api/feed", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idea.id }),
      });
      if (!res.ok) throw new Error("削除失敗");
      setPendingIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除失敗");
    } finally {
      setDismissing((s) => {
        const n = new Set(s);
        n.delete(idea.id);
        return n;
      });
    }
  }

  async function loadHistory(id: string) {
    setLoadingHistoryId(id);
    try {
      // 履歴本体 + 最新 destinations を並列取得 (履歴保存後にプロンプト設定された場合に
      // 古い destinationStatus.promptReady を最新値で上書きするため)
      const [histRes, destsRes] = await Promise.all([
        fetch(`/api/products/scout/history/${id}`),
        fetch("/api/destinations"),
      ]);
      const data = await histRes.json();
      if (!histRes.ok) throw new Error(data.error ?? "履歴取得失敗");
      const destsData = (await destsRes.json()) as {
        destinations?: Array<{ id: string; prompt_config?: unknown }>;
      };
      // destinationId → 現在の promptReady のマップ
      const promptReadyMap = new Map<string, boolean>();
      for (const d of destsData.destinations ?? []) {
        const pc = d.prompt_config as Record<string, unknown> | null | undefined;
        const ready =
          !!pc &&
          Object.values(pc).some(
            (v) => typeof v === "string" && v.trim().length > 0,
          );
        promptReadyMap.set(d.id, ready);
      }
      // candidates の destinationStatus.promptReady を最新値で上書き
      const candidates = (data.candidates as ScoutCandidate[] | undefined) ?? [];
      for (const c of candidates) {
        if (c.destinationStatus) {
          for (const s of c.destinationStatus) {
            if (promptReadyMap.has(s.destinationId)) {
              s.promptReady = promptReadyMap.get(s.destinationId);
            }
          }
        }
      }

      const restored: ScoutResponse = {
        subject: data.subject,
        candidateCount: data.candidateCount,
        candidates,
        // migration 0017 以降に保存された履歴は rejectedCandidates / stats も持つ
        rejectedCandidates:
          (data.rejectedCandidates as RejectedCandidate[] | undefined) ?? undefined,
        stats: (data.stats as ScoutResponse["stats"]) ?? undefined,
        historyId: data.id,
      };
      // 履歴クリック時は subject 入力欄を触らない (新規スカウトタブに切替えた時に過去
      // subject が prefill されてしまうのを防ぐ。subject は result.subject 経由で表示)
      setResult(restored);
      setExpanded(new Set());
      setIdeized(new Set());
      setError(null);
      // タブ移動はしない。同じ「スカウト履歴」タブ内で履歴リストの下に結果を展開表示。
    } catch (e) {
      alert(e instanceof Error ? e.message : "履歴取得失敗");
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function refineKw(kw: string) {
    setRefining((s) => new Set([...s, kw]));
    try {
      const res = await fetch("/api/products/scout/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ahrefs 精査失敗");
      setAhrefsMetrics((m) => ({
        ...m,
        [kw]: {
          kd: data.metrics?.keywordDifficulty ?? null,
          vol: data.metrics?.searchVolume ?? null,
          cpc: data.metrics?.cpc ?? null,
        },
      }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ahrefs 精査失敗");
    } finally {
      setRefining((s) => {
        const n = new Set(s);
        n.delete(kw);
        return n;
      });
    }
  }

  async function backfillCategories() {
    setBackfilling(true);
    try {
      const res = await fetch("/api/products/scout/history/backfill-category", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "推定失敗");
      alert(data.message ?? "完了");
      await refreshHistory();
    } catch (e) {
      alert(e instanceof Error ? e.message : "推定失敗");
    } finally {
      setBackfilling(false);
    }
  }

  async function deleteHistory(id: string, subjectLabel: string) {
    if (!confirm(`「${subjectLabel}」のスカウト履歴を削除しますか?`)) return;
    try {
      const res = await fetch(`/api/products/scout/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除失敗");
      // 表示中の結果と同じものを消したらクリア
      if (result?.historyId === id) setResult(null);
      await refreshHistory();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除失敗");
    }
  }

  // subject / result / ideized を都度キャッシュに書き戻す
  useEffect(() => {
    setCache(CACHE_SUBJECT, subject);
  }, [subject]);
  useEffect(() => {
    if (result) setCache(CACHE_RESULT, result);
  }, [result]);
  useEffect(() => {
    setCache(CACHE_IDEIZED, Array.from(ideized));
  }, [ideized]);

  async function scout() {
    // 送信値はローカル変数に取ってから入力欄をクリア (連続スカウトで前のテキストが残らないように)
    const subjectToSend = subject.trim();
    setSubject("");
    setBusy(true);
    setError(null);
    setResult(null);
    setExpanded(new Set());
    setIdeized(new Set());
    try {
      const res = await fetch("/api/products/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subjectToSend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "スカウト失敗");
      setResult(data);
      refreshHistory();
      // スカウト完了直後に履歴タブへ自動切替 (左=履歴, 右=結果KW の2カラム表示に乗せる)
      setTab("history");
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗");
    } finally {
      setBusy(false);
    }
  }

  // 1候補を ideas (フィード) に追加する。生成された FeedIdea を返す
  async function ideizeCandidate(c: ScoutCandidate): Promise<FeedIdea | null> {
    const res = await fetch("/api/products/ideize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kw: c.kw,
        intent: c.intent,
        reason: c.reason,
        seoDifficulty: c.seoDifficulty,
        opportunityScore: c.opportunityScore,
        rationale: c.rationale,
        subject: result?.subject,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "ネタ化失敗");
    return (data.idea as FeedIdea) ?? null;
  }

  // ネタ化のみ (フィードに残すだけ)
  async function ideize(c: ScoutCandidate) {
    try {
      await ideizeCandidate(c);
      setIdeized((s) => new Set([...s, c.kw]));
    } catch (e) {
      alert(e instanceof Error ? e.message : "ネタ化失敗");
    }
  }

  // ネタ化 + 記事生成キュー投入 (1ボタンで連続実行)
  // destinationStatus を見て:
  // 2026-06-09: 「✍記事生成」を **全 destination で並列生成** に変更。
  //   各サイトの 3段プロンプトでそれぞれ独立に記事を作る方針 (MTG決定の意図)。
  //   - プロンプト未設定の destination は除外
  //   - 全 destination がプロンプト未設定なら エラー
  //   - 結果は「✅ note + はてな + livedoor の3サイトで生成キュー投入」のような形で通知
  async function generateFromCandidate(c: ScoutCandidate) {
    if (!c.destinationStatus || c.destinationStatus.length === 0) return;

    const promptReadyList = c.destinationStatus.filter((s) => s.promptReady);
    const summary = c.destinationStatus
      .map((s) => {
        if (!s.promptReady) return `❌ ${s.platformLabel}: プロンプトなし → スキップ`;
        if (s.occupied) return `✅ ${s.platformLabel}: 生成キュー投入 (上位${s.hits}件に競合あり)`;
        return `✅ ${s.platformLabel}: 生成キュー投入`;
      })
      .join("\n");

    if (promptReadyList.length === 0) {
      alert(
        `❌ 全ての投稿先でプロンプト未設定のため記事生成できません。\n\n${summary}\n\n設定 → 投稿先 → 各行の「プロンプト」ボタンから先にプロンプトを設定してください。`,
      );
      return;
    }

    setGenerating((s) => new Set([...s, c.kw]));
    try {
      const idea = await ideizeCandidate(c);
      if (!idea) throw new Error("ideaの生成に失敗しました");
      // 全 promptReady destination を並列でキュー投入
      for (const dest of promptReadyList) {
        enqueue([idea], dest.destinationId);
      }
      setIdeized((s) => new Set([...s, c.kw]));
      // 数件以上同時投入はユーザーに通知 (1件だけだと alert は煩いので 2件以上で)
      if (promptReadyList.length >= 2) {
        console.info(
          `[generate] ${promptReadyList.length} destinations に並列投入\n${summary}`,
        );
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "記事生成キュー投入失敗");
    } finally {
      setGenerating((s) => {
        const n = new Set(s);
        n.delete(c.kw);
        return n;
      });
    }
  }

  function toggleExpand(i: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  return (
    <>
      <PageHeader title="KWスカウト">
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px overflow-x-auto">
            <GroupTab active={tab === "new"} onClick={() => setTab("new")}>
              新規スカウト
            </GroupTab>
            <GroupTab active={tab === "history"} onClick={() => setTab("history")}>
              スカウト履歴
              {history.length > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({history.length})</span>
              )}
            </GroupTab>
            <GroupTab active={tab === "adopted"} onClick={() => setTab("adopted")}>
              採用KW
              {adoptedCount > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({adoptedCount})</span>
              )}
            </GroupTab>
            <GroupTab active={tab === "pending"} onClick={() => setTab("pending")}>
              保留KW
              {pendingCount > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({pendingCount})</span>
              )}
            </GroupTab>
            <GroupTab active={tab === "config"} onClick={() => setTab("config")}>
              スカウト設定
            </GroupTab>
          </div>
        </FilterBar>
      </PageHeader>

      {/* 新規スカウトタブは subject 入力が広くなりすぎないよう max-w-3xl で抑える。
          履歴タブは PageHeader (sticky z-20) 直下に sticky で張り付け + main の
          左右 padding (px-4/md:px-8) を -mx で打ち消して、タブバー (FilterBar) と
          同じ画面端まで 2カラムを広げる */}
      <div
        className={
          tab === "history" || tab === "pending" || tab === "adopted"
            ? "md:sticky md:top-0 md:h-[calc(100vh-140px)] md:overflow-hidden md:-mt-8 -mt-6 -mx-4 md:-mx-8 px-2 md:px-4"
            : tab === "config"
              ? ""
              : "max-w-3xl space-y-5"
        }
      >
        {tab === "new" && (
        <div className="space-y-2">
          <label htmlFor="subject" className="text-[12px] text-[color:var(--fg-secondary)]">
            商品名 / お題 (例: ワイヤレスイヤホン / オーディオブック / 寝る前 ヨガマット)
          </label>
          <div className="flex gap-2">
            <input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && subject.trim() && !busy) scout();
              }}
              placeholder="例: ワイヤレスイヤホン 寝るとき"
              className="input-base flex-1"
              disabled={busy}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={scout}
              disabled={busy || !subject.trim()}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              {busy ? "調査中…" : "スカウト開始"}
            </button>
          </div>
          <p className="text-[11px] text-[color:var(--fg-muted)]">
            ⚠ 1回あたり Gemini × 3 + DataForSEO × 4 (6段パイプライン)。 1スカウト ¥35 前後 / 100KW から採用3-5件
          </p>
        </div>
        )}

        {tab === "new" && error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-[12px]">{error}</div>
        )}

        {/* スカウト履歴タブ: 左 (一覧+フィルタ) / 右 (KW詳細) の2カラム
            grid 親に固定高さを与えて、子の overflow-y-auto が機能するように。
            これで「ページ全体スクロール」ではなく「カラム内スクロール」になり、
            内部 sticky ヘッダがちゃんと固定される */}
        {tab === "history" && (
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 md:h-full">
            {/* 左: 履歴一覧 + ジャンルフィルタ。flex-col で「固定ヘッダ + スクロール領域」に分割 */}
            <div className="flex flex-col md:h-full min-h-0">
              {historyLoading ? (
                <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
              ) : history.length === 0 ? (
                <div className="p-6 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                  <p className="text-[13px] text-[color:var(--fg-secondary)]">
                    まだ履歴がありません
                  </p>
                  <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
                    「新規スカウト」タブからスカウト実行すると、ここに自動保存されます
                  </p>
                </div>
              ) : (
                <>
                  {/* ジャンルフィルタ (左カラムのスクロール時に固定) */}
                  {(() => {
                    const cats = Array.from(
                      new Set(history.map((h) => h.category).filter((c): c is string => !!c)),
                    ).sort();
                    const uncategorized = history.filter((h) => !h.category).length;
                    return (
                      <>
                        {/* 固定ヘッダ (スクロールバーがこの下から始まる) */}
                        <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center">
                          {cats.length > 0 ? (
                            <select
                              value={historyCategoryFilter}
                              onChange={(e) => setHistoryCategoryFilter(e.target.value)}
                              className="input-base text-[11px] py-1.5 w-full"
                            >
                              <option value="">すべて ({history.length})</option>
                              {cats.map((c) => {
                                const count = history.filter((h) => h.category === c).length;
                                return (
                                  <option key={c} value={c}>
                                    {c} ({count})
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <div className="text-[11px] text-[color:var(--fg-muted)]">
                              履歴 {history.length} 件
                            </div>
                          )}
                        </div>
                        {/* バックフィル: 未分類が残ってる時だけ表示 (ヘッダの下、スクロール領域の上) */}
                        {uncategorized > 0 && (
                          <button
                            type="button"
                            onClick={backfillCategories}
                            disabled={backfilling}
                            className="shrink-0 mt-2 w-full text-[10px] px-2 py-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50 disabled:cursor-wait border border-blue-200"
                            title="Gemini で subject から category を一括推定して埋める"
                          >
                            {backfilling
                              ? "⏳ 分類中…"
                              : `📂 未分類 ${uncategorized}件 を一括分類`}
                          </button>
                        )}
                      </>
                    );
                  })()}

                  {/* 履歴リスト (この領域だけがスクロールするので、スクロールバーがヘッダ下から始まる) */}
                  <ul className="flex-1 overflow-y-auto space-y-1.5 mt-2 pr-1 min-h-0">
                    {history
                      .filter((h) =>
                        historyCategoryFilter ? h.category === historyCategoryFilter : true,
                      )
                      .map((h) => {
                        const isCurrent = result?.historyId === h.id;
                        const isLoading = loadingHistoryId === h.id;
                        return (
                          <li
                            key={h.id}
                            className={`flex items-center gap-2 p-3 rounded-lg border text-[12px] ${
                              isCurrent
                                ? "bg-[color:var(--accent-soft)] border-[color:var(--accent)]"
                                : "bg-white border-[var(--border-subtle)] hover:bg-gray-50"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => loadHistory(h.id)}
                              disabled={isLoading}
                              className="flex-1 min-w-0 text-left disabled:opacity-50 disabled:cursor-wait"
                              title={isCurrent ? "現在表示中" : "クリックで結果を表示"}
                            >
                              <div className="font-semibold text-[13px] text-[color:var(--fg-primary)] truncate">
                                {isLoading ? "⏳ " : isCurrent ? "👁 " : ""}
                                {h.subject}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {h.category && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                                    {h.category}
                                  </span>
                                )}
                                <span className="text-[10px] text-[color:var(--fg-muted)]">
                                  {h.candidate_count}件
                                </span>
                              </div>
                              <div className="text-[9px] text-[color:var(--fg-muted)] mt-0.5">
                                {new Date(h.created_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteHistory(h.id, h.subject)}
                              className="text-[11px] text-red-500 hover:text-red-700 shrink-0 px-1"
                              title="この履歴を削除"
                            >
                              🗑
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </>
              )}
            </div>

            {/* 右: 選択中履歴の KW 詳細 (flex-col で「固定ヘッダ + スクロール領域」分割) */}
            <div className="min-w-0 flex flex-col md:h-full min-h-0">
              {!result ? (
                <div className="p-6 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                  <p className="text-[13px] text-[color:var(--fg-secondary)]">
                    左の履歴を選ぶと、ここに KW一覧 が表示されます
                  </p>
                </div>
              ) : (
                <>
                  {/* 固定タイトル (左の絞り込みヘッダと同じ h-[60px] で揃える) */}
                  <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <div className="text-[10px] text-[color:var(--fg-muted)] leading-tight">
                        スカウト結果 {result.candidateCount} 件 (機会スコア降順)
                      </div>
                      <div
                        className="font-semibold text-[13px] text-[color:var(--fg-primary)] truncate leading-tight mt-0.5"
                        title={result.subject}
                      >
                        {result.subject}
                      </div>
                    </div>
                    {/* パイプライン段階タブ (各段階の通過件数)
                     * stats が DB 保存外 (過去履歴) でも candidates / rejectedCandidates
                     * から導出した値で表示する。 */}
                    {(() => {
                      const rej = result.rejectedCandidates ?? [];
                      const cand = result.candidates ?? [];
                      const stats = result.stats ?? {
                        stage1Generated: cand.length + rej.length,
                        stage3Passed: cand.length,
                        finalCount: cand.length,
                        adoptedCount: cand.filter((c) => c.decision === "adopt").length,
                      };
                      return (
                      <div className="shrink-0 flex items-center gap-1">
                        {([
                          { s: 1 as const, label: `① ${stats.stage1Generated}`, title: "Gemini #1 が生成した KW 全件" },
                          { s: 3 as const, label: `② ${stats.stage3Passed}`, title: "Stage 3 Gemini #2 (数値+重複排除) を通過した KW" },
                          { s: 5 as const, label: `③ ${stats.adoptedCount}`, title: "Stage 5 最終採用された KW" },
                        ]).map(({ s, label, title }) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setPipelineStage(s)}
                            title={title}
                            className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                              pipelineStage === s
                                ? "bg-[color:var(--accent)] text-white font-semibold shadow-sm"
                                : "bg-white text-[color:var(--fg-secondary)] border border-[var(--border-card)] hover:bg-[color:var(--accent-soft)]/40"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      );
                    })()}
                  </div>
                  {/* スクロール領域 (この部分だけスクロールバー表示) */}
                  <div className="flex-1 overflow-y-auto pr-2 mt-2 min-h-0">
                  {/* === パイプライン段階別ビュー ① / ② === */}
                  {pipelineStage !== 5 && (
                    <StagePipelineView
                      stage={pipelineStage}
                      adopted={result.candidates}
                      rejected={result.rejectedCandidates ?? []}
                    />
                  )}
                  {/* === ③ Stage 5 最終採用候補リスト (詳細カード) === */}
                  {pipelineStage === 5 && (
                  <ul className="space-y-2">
                    {result.candidates.map((c, i) => {
                      const isOpen = expanded.has(i);
                      const isIdeized = ideized.has(c.kw);
                      // decision バッジ (P4 / 拡張プラン B' の最終判定)
                      const decisionBadge = c.decision === "adopt"
                        ? { text: "✓ 採用", cls: "bg-emerald-100 text-emerald-700 font-semibold" }
                        : c.decision === "reject"
                          ? { text: "✕ 却下", cls: "bg-red-100 text-red-700" }
                          : c.decision === "borderline"
                            ? { text: "△ 要検討", cls: "bg-yellow-100 text-yellow-700" }
                            : null;
                      // SERP feature の有効なものだけ抽出 (日本語ラベル + tooltip付き)
                      const activeFeatures: Array<{ label: string; tip: string }> = [];
                      if (c.serpFeatures) {
                        if (c.serpFeatures.hasAiOverview)
                          activeFeatures.push({ label: "🤖 AI要約", tip: "AI Overview: Google AI が検索結果上部に要約を生成。SEO に有利な切り口を見せられる" });
                        if (c.serpFeatures.hasFeaturedSnippet)
                          activeFeatures.push({ label: "⭐ 注目回答", tip: "Featured Snippet: 検索結果の最上部にゼロ位として抜粋表示される枠。狙えれば爆発的に流入" });
                        if (c.serpFeatures.hasKnowledgePanel)
                          activeFeatures.push({ label: "📚 知識パネル", tip: "Knowledge Panel: Google が公式情報を集めた右サイドパネル。ブランドや人物等の検索で出る" });
                        if (c.serpFeatures.hasPaa)
                          activeFeatures.push({ label: "❓ 関連質問", tip: "People Also Ask: 「他の人はこちらも質問」枠。Q&A 形式の見出しを記事に入れると拾われやすい" });
                        if (c.serpFeatures.hasShopping)
                          activeFeatures.push({ label: "🛒 ショッピング", tip: "Shopping枠: 商品比較カードが表示される = 購買意図が強い = アフィリ向き" });
                        if (c.serpFeatures.hasTopStories)
                          activeFeatures.push({ label: "📰 ニュース", tip: "Top Stories: ニュース記事枠。トレンド/速報性のあるテーマ" });
                        if (c.serpFeatures.hasVideo)
                          activeFeatures.push({ label: "🎬 動画", tip: "Video枠: YouTube等の動画が SERP に出る。使い方系/レビュー系 KW" });
                      }
                      return (
                        <li
                          key={i}
                          className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {decisionBadge && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${decisionBadge.cls}`}>
                                    {decisionBadge.text}
                                  </span>
                                )}
                                {typeof c.finalScore === "number" && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] font-mono">
                                    総合 {c.finalScore}
                                  </span>
                                )}
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                                  {INTENT_LABEL[c.intent] ?? c.intent}
                                </span>
                                {/* 互換: 旧履歴の seoDifficulty バッジ */}
                                {c.seoDifficulty && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${DIFF_BADGE[c.seoDifficulty].cls}`}>
                                    {DIFF_BADGE[c.seoDifficulty].text}
                                  </span>
                                )}
                              </div>
                              <div className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                                {c.kw}
                              </div>
                              <div className="text-[11px] text-[color:var(--fg-muted)] mt-0.5">
                                {c.reason}
                              </div>
                              {/* 💎 お宝スコア + 評価の内訳 (2026-06-15)
                                * 採用カード (decision="adopt") は常時展開、それ以外は折りたたみ */}
                              {c.treasureScore && (() => {
                                const ts = c.treasureScore;
                                const rankInfo: Record<typeof ts.rank, { emoji: string; label: string; cls: string }> = {
                                  treasure3: { emoji: "💎💎💎", label: "超お宝", cls: "bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold" },
                                  treasure2: { emoji: "💎💎",   label: "お宝",   cls: "bg-emerald-100 text-emerald-800 font-bold" },
                                  treasure1: { emoji: "💎",     label: "準お宝", cls: "bg-amber-100 text-amber-800 font-semibold" },
                                  normal:    { emoji: "·",      label: "通常",   cls: "bg-gray-100 text-gray-600" },
                                };
                                const info = rankInfo[ts.rank];
                                const isAdopted = c.decision === "adopt";
                                return (
                                  <details className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-white" open={isAdopted}>
                                    <summary className="cursor-pointer px-2.5 py-1.5 flex items-center gap-2 text-[11px]">
                                      <span className={`px-2 py-1 rounded ${info.cls} text-[12px]`}>
                                        {info.emoji} {info.label} {ts.total}<span className="opacity-70">/110</span>
                                      </span>
                                      <span className="text-[10px] text-[color:var(--fg-muted)]">▼ 評価の内訳</span>
                                    </summary>
                                    <ul className="px-3 pb-2 pt-1 space-y-0.5 text-[10.5px] text-[color:var(--fg-secondary)]">
                                      <li className="flex gap-2">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold text-emerald-700">+{ts.breakdown.kd.points}</span>
                                        <span>🔧 {ts.breakdown.kd.reason}</span>
                                      </li>
                                      <li className="flex gap-2">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold text-emerald-700">+{ts.breakdown.sv.points}</span>
                                        <span>📊 {ts.breakdown.sv.reason}</span>
                                      </li>
                                      <li className="flex gap-2">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold text-emerald-700">+{ts.breakdown.cvKw.points}</span>
                                        <span>💰 {ts.breakdown.cvKw.reason}</span>
                                      </li>
                                      <li className="flex gap-2">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold text-emerald-700">+{ts.breakdown.serp.points}</span>
                                        <span>🌐 {ts.breakdown.serp.reason}</span>
                                      </li>
                                      <li className="flex gap-2">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold text-emerald-700">+{ts.breakdown.aiOverview.points}</span>
                                        <span>✨ {ts.breakdown.aiOverview.reason}</span>
                                      </li>
                                      <li className="flex gap-2 pt-1 border-t border-[var(--border-subtle)] mt-1">
                                        <span className="shrink-0 w-6 text-right font-mono font-bold">={ts.total}</span>
                                        <span className="font-semibold">{info.emoji} {info.label}判定</span>
                                      </li>
                                    </ul>
                                  </details>
                                );
                              })()}
                              {/* 客観指標 (DFS Keyword Overview) — データ取得失敗時は "-" 表示 */}
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[10.5px]">
                                <span
                                  className={`px-1.5 py-0.5 rounded ${
                                    typeof c.kd !== "number"
                                      ? "bg-gray-100 text-gray-500"
                                      : c.kd <= 30
                                        ? "bg-emerald-100 text-emerald-800 font-bold"
                                        : c.kd <= 50
                                          ? "bg-amber-50 text-amber-700"
                                          : "bg-rose-50 text-rose-700"
                                  }`}
                                  title={
                                    typeof c.kd !== "number"
                                      ? "DFS から KD が取得できませんでした (Backlinks API レスポンス欠損 or サブスク未契約)"
                                      : c.kd <= 30
                                        ? `KD ${c.kd} (Backlinks 実数値): 個人ブログで戦える / 狙い目`
                                        : c.kd <= 50
                                          ? `KD ${c.kd} (Backlinks 実数値): 中難度 / 切り口次第`
                                          : `KD ${c.kd} (Backlinks 実数値): 上位表示困難 / 大手寡占の可能性`
                                  }
                                >
                                  🔧 KD <strong>{typeof c.kd === "number" ? c.kd : "-"}</strong>
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                  月Vol <strong>{typeof c.searchVolume === "number" ? c.searchVolume.toLocaleString("ja-JP") : "-"}</strong>
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                  CPC <strong>{typeof c.cpc === "number" ? `¥${Math.round(c.cpc * 150).toLocaleString("ja-JP")}` : "-"}</strong>
                                </span>
                                {c.competitionLevel && (() => {
                                  const compInfo: Record<string, { jp: string; cls: string; tip: string }> = {
                                    HIGH: { jp: "高", cls: "bg-red-50 text-red-700", tip: "競合 HIGH: 広告出稿者が多い = 商業価値が高い KW (= アフィリ向き)" },
                                    MEDIUM: { jp: "中", cls: "bg-amber-50 text-amber-700", tip: "競合 MEDIUM: 中程度の広告需要。バランスの取れた KW" },
                                    LOW: { jp: "低", cls: "bg-gray-50 text-gray-600", tip: "競合 LOW: 広告需要少なめ。情報系 KW か超ニッチ" },
                                  };
                                  const info = compInfo[c.competitionLevel] ?? { jp: c.competitionLevel, cls: "bg-gray-50 text-gray-600", tip: c.competitionLevel };
                                  return (
                                    <span className={`px-1.5 py-0.5 rounded cursor-help ${info.cls}`} title={info.tip}>
                                      広告競合 {info.jp}
                                    </span>
                                  );
                                })()}
                                {/* DFS Intent は Google 公式 intent と概念被るので、後者がなければフォールバック表示 */}
                                {!c.googleIntent && c.searchIntent && (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 cursor-help"
                                    title="DFS 推定 intent (補助データ)。Google 公式 intent が取得できなかった場合のフォールバック"
                                  >
                                    🔮 {c.searchIntent}
                                  </span>
                                )}
                                {/* A. Google 公式 intent (Search Intent API)
                                  * 4種類: transactional > commercial > navigational > informational
                                  * 日本語ラベル + 確信度 + 解説 tooltip でユーザーが意味を理解できるように */}
                                {c.googleIntent && (() => {
                                  const intentInfo: Record<string, { jp: string; emoji: string; cls: string; tip: string }> = {
                                    transactional: {
                                      jp: "今すぐ購入",
                                      emoji: "💰",
                                      cls: "bg-emerald-100 text-emerald-800",
                                      tip: "Transactional: 「買う直前」の検索 (例: ○○ 価格、○○ amazon)。CV に直結する最重要 intent。アフィリ収益化しやすい",
                                    },
                                    commercial: {
                                      jp: "商品比較",
                                      emoji: "🛍️",
                                      cls: "bg-teal-100 text-teal-800",
                                      tip: "Commercial: 「買う前に比較・検討」の検索 (例: ○○ おすすめ、○○ 違い)。比較記事・口コミ記事と相性◎。アフィリ向き",
                                    },
                                    navigational: {
                                      jp: "公式探し",
                                      emoji: "🧭",
                                      cls: "bg-blue-100 text-blue-800",
                                      tip: "Navigational: 「特定サイトに行く」検索 (例: amazon ログイン、○○ 公式)。読者は既に行き先決定済なのでアフィリ向きでない",
                                    },
                                    informational: {
                                      jp: "情報収集",
                                      emoji: "📖",
                                      cls: "bg-amber-50 text-amber-800",
                                      tip: "Informational: 「知りたい」の検索 (例: ○○ とは、○○ やり方)。CV 直結はしにくいが SEO 集客の入口として有効",
                                    },
                                  };
                                  const info = intentInfo[c.googleIntent] ?? {
                                    jp: c.googleIntent,
                                    emoji: "🎯",
                                    cls: "bg-gray-100 text-gray-700",
                                    tip: c.googleIntent,
                                  };
                                  const prob = Math.round((c.googleIntentProb ?? 0) * 100);
                                  return (
                                    <span
                                      className={`px-1.5 py-0.5 rounded font-semibold ${info.cls} cursor-help`}
                                      title={`${info.tip}\n\nGoogle 公式判定 (確信度: ${prob}%)`}
                                    >
                                      {info.emoji} {info.jp}{prob > 0 ? ` ${prob}%` : ""}
                                    </span>
                                  );
                                })()}
                                {/* CVKW スコア (購入意図の強さ) */}
                                {typeof c.cvKwScore === "number" && (() => {
                                  const score = c.cvKwScore;
                                  const cls = score >= 70 ? "bg-emerald-100 text-emerald-800 font-bold"
                                    : score >= 50 ? "bg-teal-100 text-teal-700 font-semibold"
                                    : score >= 30 ? "bg-amber-50 text-amber-700"
                                    : "bg-gray-100 text-gray-500";
                                  const hitsStr = [c.cvKwHits?.strong, c.cvKwHits?.mid, c.cvKwHits?.brand]
                                    .filter(Boolean).join(" / ");
                                  const tip = `CV直結度 ${score}/100 (CVKW = 購入直前/比較検討の検索意図 KW)\n${score >= 70 ? "強CVKW: 購入クリック直結" : score >= 50 ? "中CVKW: 比較検討段階" : score >= 30 ? "弱CVKW" : "非CVKW"}${hitsStr ? `\n反応した語: ${hitsStr}` : ""}`;
                                  return (
                                    <span className={`px-1.5 py-0.5 rounded cursor-help ${cls}`} title={tip}>
                                      💰 CV直結 {score}
                                    </span>
                                  );
                                })()}
                                {/* B. 季節性 (ピーク月) */}
                                {c.peakMonths && c.peakMonths.length > 0 && (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                                    title="過去12ヶ月でSVが平均20%以上高い月"
                                  >
                                    📈 ピーク {c.peakMonths.join("/")}月
                                  </span>
                                )}
                              </div>
                              {/* C. Top3 競合の中身 (SERP の title + snippet)
                                * 用途: 「Top3 がどんな切り口で書いているか」を見て、別角度で書けば勝てる
                                * 採用カードでは常時展開、それ以外は折りたたみ */}
                              {c.topPageStructures && c.topPageStructures.length > 0 && (
                                <details className="mt-2 text-[10px] bg-blue-50/40 border border-blue-100 rounded-lg p-2" open={c.decision === "adopt"}>
                                  <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--accent-dark)] hover:text-[color:var(--accent)]">
                                    ✏️ 上位3記事の「切り口」 — ここと違う角度で書けば勝てる
                                  </summary>
                                  <p className="mt-1 mb-1.5 text-[9.5px] text-[color:var(--fg-muted)] leading-relaxed">
                                    ⬇️ Top3 がどんなタイトル・要点で書いているか。自分は<strong>違う角度</strong>(体験談 / 写真 / 別ターゲット / 細かい比較項目など)で書くと食い込みやすい。
                                  </p>
                                  <ul className="space-y-1.5">
                                    {c.topPageStructures.map((s, si) => {
                                      const hasTitle = !!s.title;
                                      const hasDesc = !!s.description;
                                      const hasOldWord = typeof s.wordCount === "number" && s.wordCount > 0;
                                      const hasOldH2 = typeof s.h2Count === "number" && s.h2Count > 0;
                                      const hasAny = hasTitle || hasDesc || hasOldWord || hasOldH2;
                                      // 概要文は冒頭 120文字に丸める (情報量を絞る)
                                      const shortDesc = hasDesc && s.description
                                        ? s.description.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*[—\-]\s*/, "").slice(0, 120) + (s.description.length > 120 ? "…" : "")
                                        : null;
                                      return (
                                        <li key={si} className="flex gap-2 text-[color:var(--fg-secondary)]">
                                          <span className="shrink-0 text-[11px] font-bold text-[color:var(--accent-dark)] w-7">
                                            {s.rank ?? si + 1}位
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-[9px] text-[color:var(--fg-muted)] truncate">
                                              {s.domain ?? "?"}
                                            </div>
                                            {hasTitle && (
                                              <div className="text-[10.5px] font-semibold text-[color:var(--fg-primary)] leading-tight mt-0.5">
                                                {s.title}
                                              </div>
                                            )}
                                            {shortDesc && (
                                              <div className="text-[9.5px] text-[color:var(--fg-muted)] leading-relaxed mt-0.5">
                                                💬 {shortDesc}
                                              </div>
                                            )}
                                            {(hasOldWord || hasOldH2) && (
                                              <div className="text-[9px] text-[color:var(--fg-muted)] mt-0.5 font-mono">
                                                {hasOldWord && `${s.wordCount}字 `}
                                                {hasOldH2 && `H2 ${s.h2Count}個`}
                                              </div>
                                            )}
                                            {!hasAny && (
                                              <div className="text-[9px] text-gray-400 italic mt-0.5">
                                                (旧履歴のため詳細なし。新規スカウトで表示)
                                              </div>
                                            )}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </details>
                              )}
                              {/* SERP features (検索結果ページに出ている枠) */}
                              {activeFeatures.length > 0 && (
                                <>
                                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[10px]">
                                    <span
                                      className="text-[color:var(--fg-muted)]"
                                      title="Google 検索結果ページに表示されている特別枠。記事構成のヒントになる"
                                    >
                                      検索結果の特徴:
                                    </span>
                                    {activeFeatures.map((f) => (
                                      <span
                                        key={f.label}
                                        title={f.tip}
                                        className={`px-1.5 py-0.5 rounded cursor-help ${
                                          f.label.startsWith("🤖")
                                            ? "bg-fuchsia-50 text-fuchsia-700 font-semibold"
                                            : "bg-slate-100 text-slate-700"
                                        }`}
                                      >
                                        {f.label}
                                      </span>
                                    ))}
                                  </div>
                                  {/* 採用 KW のときだけ「これがあると何を意味するか」の解説を常時表示 */}
                                  {c.decision === "adopt" && (
                                    <ul className="mt-1 pl-1 space-y-0.5 text-[9.5px] text-[color:var(--fg-secondary)] leading-relaxed">
                                      {activeFeatures.map((f) => (
                                        <li key={`tip-${f.label}`}>
                                          <span className="font-semibold mr-1">{f.label}:</span>
                                          {f.tip.replace(/^[^:]+:\s*/, "")}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                              )}
                              {/* AI Overview 引用元 */}
                              {c.aiOverviewReferences && c.aiOverviewReferences.length > 0 && (
                                <div className="mt-1.5 text-[10px] text-[color:var(--fg-secondary)]">
                                  <span className="text-fuchsia-700 font-semibold">🤖 AI Overview引用:</span>{" "}
                                  {c.aiOverviewReferences
                                    .slice(0, 5)
                                    .map((r) => r.domain ?? new URL(r.url).hostname)
                                    .join(" / ")}
                                </div>
                              )}
                              {/* 最終 rationale (Gemini #3 最終判定) */}
                              {c.rationale && (
                                <div className="text-[11px] text-[color:var(--fg-secondary)] mt-1.5 leading-snug p-2 rounded bg-amber-50/40 border border-amber-100">
                                  💡 {c.rationale}
                                </div>
                              )}
                              {/* 互換: 旧履歴の上位ドメイン分類 */}
                              {c.buckets && (
                                <div className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                                  上位{c.totalScanned ?? 0}件: EC {c.buckets.big_ec} / 比較メディア {c.buckets.big_media} /
                                  個人ブログ {c.buckets.individual_blog} / その他 {c.buckets.other}
                                </div>
                              )}
                              {/* Ahrefs 精査結果 UI は 2026-06-09 に非表示化。
                                  ahrefsMetrics state は保持 (再表示するときの復旧用) */}
                              {c.destinationStatus && c.destinationStatus.length > 0 && (
                                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-[color:var(--fg-muted)] mr-1">投稿先:</span>
                                  {c.destinationStatus.map((s) => {
                                    // 競合状況のみ表示 (プロンプト有無は投稿時にチェックするのでここでは出さない)
                                    const cls = s.occupied
                                      ? "bg-red-50 text-red-700"
                                      : "bg-green-50 text-green-700";
                                    const label = s.occupied
                                      ? `⚠ ${s.platformLabel} 競合${s.hits}件`
                                      : `✓ ${s.platformLabel} 隙間あり`;
                                    const title = s.occupied
                                      ? `${s.platformLabel} 上位10件に ${s.hits} 件存在 → 投稿しても勝ちにくい`
                                      : `${s.platformLabel} 上位10件に該当記事なし → 投稿チャンス`;
                                    return (
                                      <span
                                        key={s.destinationId}
                                        className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}
                                        title={title}
                                      >
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {isOpen && (() => {
                                // 新パイプラインは serpTopUrls、旧履歴は topUrls
                                const urls = c.serpTopUrls ?? c.topUrls ?? [];
                                if (urls.length === 0) return null;
                                return (
                                  <ul className="mt-2 space-y-0.5 pl-4">
                                    {urls.map((u, j) => (
                                      <li key={j} className="text-[10px] text-[color:var(--fg-muted)] truncate">
                                        {j + 1}. <a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a>
                                      </li>
                                    ))}
                                  </ul>
                                );
                              })()}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => toggleExpand(i)}
                                className="text-[10px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                              >
                                {isOpen ? "閉じる" : "URL"}
                              </button>
                              {/* 🔬 Ahrefs 精査ボタンは 2026-06-09 に UI 非表示化。
                                  Ahrefs 併用方針を再開する場合はここを復活。
                                  ロジック (refineKw / lib/ahrefs.ts) はコード上残置 */}
                              <button
                                type="button"
                                onClick={() => ideize(c)}
                                disabled={isIdeized}
                                className={`text-[10px] px-2 py-1 rounded whitespace-nowrap ${
                                  isIdeized
                                    ? "bg-green-100 text-green-700 cursor-default"
                                    : "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white"
                                }`}
                              >
                                {isIdeized ? "✓ 保留済" : "保留"}
                              </button>
                              <button
                                type="button"
                                onClick={() => generateFromCandidate(c)}
                                disabled={generating.has(c.kw)}
                                className="text-[10px] px-2 py-1 rounded whitespace-nowrap bg-[color:var(--accent)] hover:opacity-80 text-white disabled:opacity-50 disabled:cursor-wait"
                                title="保留と同時に記事生成キューに投入"
                              >
                                {generating.has(c.kw) ? "投入中…" : "✍ 記事生成"}
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                  <div className="text-[11px] text-[color:var(--fg-muted)] mt-3">
                    「保留」したKWは <button
                      type="button"
                      onClick={() => setTab("pending")}
                      className="text-[color:var(--accent-dark)] hover:underline"
                    >保留KW</button> タブに移ります。後でまとめて記事生成できます。
                  </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "new" && busy && (
          <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-gray-50 text-center text-[13px] text-[color:var(--fg-secondary)]">
            ⏳ 6段パイプライン実行中 (DFS Related/Suggestions → Gemini #1 → DFS Search Volume → Gemini #2 → DFS SERP → Gemini #3)…<br />
            <span className="text-[11px] text-[color:var(--fg-muted)]">
              1〜2分かかる場合があります
            </span>
          </div>
        )}

        {/* 保留KW タブ: scout 由来 (idea.customLabel "🛒 *") かつまだ記事化されていない idea を listing */}
        {tab === "pending" && (() => {
          const adoptedIdeaIds = new Set(
            pendingArticles
              .map((a) => (a.idea as FeedIdea)?.id)
              .filter((x): x is string => !!x),
          );
          const items = pendingIdeas.filter(
            (i) =>
              i.customLabel?.startsWith("🛒") &&
              !adoptedIdeaIds.has(i.id),
          );
          return (
            <div className="flex flex-col md:h-full min-h-0">
              <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center justify-between">
                <div className="text-[12px] text-[color:var(--fg-secondary)]">
                  保留中の KW: <strong>{items.length}</strong> 件
                </div>
                <div className="text-[10px] text-[color:var(--fg-muted)] font-mono">
                  スカウト → 保留 を実行したもの (記事生成すると採用KWへ)
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 mt-3 min-h-0">
                {pendingLoading ? (
                  <div className="text-[12px] text-[color:var(--fg-muted)] py-4">読み込み中…</div>
                ) : items.length === 0 ? (
                  <div className="p-8 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                    <p className="text-[13px] text-[color:var(--fg-secondary)]">
                      保留中の KW はありません
                    </p>
                    <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
                      「スカウト履歴」タブの候補カードから「保留」を押すと、ここに溜まります
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((idea) => {
                      const subject = idea.customLabel?.replace(/^🛒\s*/, "")?.trim();
                      const isGenerating = generatingFromPending.has(idea.id);
                      const isDismissing = dismissing.has(idea.id);
                      return (
                        <li
                          key={idea.id}
                          className="px-4 py-3 rounded-lg border border-[var(--border-card)] bg-white hover:border-gray-400 transition flex items-center gap-4"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold leading-tight truncate">
                              {idea.title}
                            </div>
                            {subject && (
                              <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5 truncate">
                                🛒 {subject}
                              </div>
                            )}
                          </div>
                          {typeof idea.priorityScore === "number" && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] text-[10.5px] w-[90px] text-center font-mono">
                              機会 {idea.priorityScore}
                            </span>
                          )}
                          <span className="shrink-0 text-[10.5px] font-mono text-[color:var(--fg-muted)] w-[90px] text-right">
                            {new Date(idea.createdAt).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={() => generateFromPendingIdea(idea)}
                            disabled={isGenerating || isDismissing}
                            className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[color:var(--accent)] hover:opacity-80 text-white disabled:opacity-50 disabled:cursor-wait"
                          >
                            {isGenerating ? "投入中…" : "✍ 記事生成"}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissPendingIdea(idea)}
                            disabled={isGenerating || isDismissing}
                            className="shrink-0 text-[12px] px-2 py-1.5 rounded-lg border border-[var(--border-card)] text-[color:var(--fg-secondary)] hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50"
                            title="保留から外す"
                          >
                            🗑
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}

        {/* 採用KW タブ: 記事生成済の scout 由来 KW を横一列リストで表示 */}
        {tab === "adopted" && (
          <div className="flex flex-col md:h-full min-h-0">
            <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center justify-between">
              <div className="text-[12px] text-[color:var(--fg-secondary)]">
                記事生成済みの KW: <strong>{adoptedCount}</strong> 件
              </div>
              <div className="text-[10px] text-[color:var(--fg-muted)] font-mono">
                スカウト → 記事生成 を実行したもの (ライブラリの該当記事に飛べます)
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 mt-3 min-h-0">
              {adoptedArticles.length === 0 ? (
                <div className="p-8 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                  <p className="text-[13px] text-[color:var(--fg-secondary)]">
                    採用KWはまだありません
                  </p>
                  <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
                    「スカウト履歴」タブの候補カードから ✍記事生成 を押すと、ここに表示されます
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {adoptedArticles.map((a) => {
                    const fi = a.idea as FeedIdea;
                    const kw = a.idea.title;
                    const sourceSubject = fi?.customLabel?.replace(/^🛒\s*/, "")?.trim();
                    const dest = destinationsForAdopted.find((d) => d.id === a.destinationId);
                    const platform = dest?.platform as Platform | undefined;
                    return (
                      <li
                        key={a.id}
                        className="px-4 py-3 rounded-lg border border-[var(--border-card)] bg-white hover:border-gray-400 transition flex items-center gap-4"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold leading-tight truncate">
                            {kw}
                          </div>
                          {sourceSubject && (
                            <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5 truncate">
                              🛒 {sourceSubject}
                            </div>
                          )}
                        </div>
                        {platform ? (
                          <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[10.5px] w-[120px]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getPlatformFaviconUrl(platform)}
                              alt=""
                              className="w-3 h-3 rounded-sm"
                              loading="lazy"
                            />
                            <span className="truncate">
                              {PLATFORM_LABELS[platform] ?? platform}
                            </span>
                          </span>
                        ) : (
                          <span className="shrink-0 w-[120px]" />
                        )}
                        {a.postedAt ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10.5px] w-[60px] text-center">
                            ✓ 投稿済
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10.5px] w-[60px] text-center">
                            ⏳ 未投稿
                          </span>
                        )}
                        <span className="shrink-0 text-[10.5px] font-mono text-[color:var(--fg-muted)] w-[90px] text-right">
                          {new Date(a.createdAt).toLocaleString("ja-JP", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <Link
                          href={`/library?id=${a.id}`}
                          className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 transition"
                        >
                          📖 記事を見る
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* スカウト設定 タブ: 旧 設定 → スカウト の中身を流用 */}
        {tab === "config" && <ScoutConfigTab />}

      </div>
    </>
  );
}

// ============================================================
// パイプライン段階別ビュー (タブ ①/②/③ で切替)
// 各段階の「通過したKW (✓)」と「落選したKW (✗)」を一覧表示する。
// ④ Stage7 は既存の候補カードリストをそのまま使うため、ここには来ない。
// ============================================================
type StageItem = {
  kw: string;
  intent: string;
  reason: string;
  kd?: number | null;
  searchVolume?: number | null;
  cpc?: number | null;
  competitionLevel?: string | null;
  searchIntent?: string | null;
  rejectionNote?: string;
  rejectedAtStage?: RejectedCandidate["stage"];
};

function StagePipelineView({
  stage,
  adopted,
  rejected,
}: {
  stage: 1 | 3;
  adopted: ScoutCandidate[];
  rejected: RejectedCandidate[];
}) {
  // 各 stage で「通過」「落選」を分類
  const { passed, failed, headline } = useMemo(() => {
    const adoptedAsItems: StageItem[] = adopted.map((c) => ({
      kw: c.kw,
      intent: c.intent,
      reason: c.reason,
      kd: c.kd,
      searchVolume: c.searchVolume,
      cpc: c.cpc,
    }));
    const rejAsItems = (filterFn: (r: RejectedCandidate) => boolean): StageItem[] =>
      rejected.filter(filterFn).map((r) => ({
        kw: r.kw,
        intent: r.intent,
        reason: r.reason,
        kd: r.kd,
        searchVolume: r.searchVolume,
        cpc: r.cpc,
        competitionLevel: r.competitionLevel,
        searchIntent: r.searchIntent,
        rejectionNote: r.rejectionNote,
        rejectedAtStage: r.stage,
      }));

    if (stage === 1) {
      // Gemini #1 が生成した全件 (落選はまだ無い)
      const all = [...adoptedAsItems, ...rejAsItems(() => true)];
      return {
        passed: all,
        failed: [] as StageItem[],
        headline: `Gemini #1 が生成した全候補 (${all.length}件)`,
      };
    }
    // stage === 3: Gemini #2 (数値+重複排除) 通過/落選
    const p = adoptedAsItems;
    const f = rejAsItems((r) => r.stage === "stage3_rejected");
    return {
      passed: p,
      failed: f,
      headline: `Stage 3 Gemini #2 (数値+重複/不適切排除)`,
    };
  }, [stage, adopted, rejected]);

  // KD=0 の件数 (Backlinks 未契約等で取得失敗している可能性のサイン)
  const kdZeroCount = [...passed, ...failed].filter((it) => it.kd === 0).length;
  const kdTotalCount = [...passed, ...failed].filter((it) => typeof it.kd === "number").length;

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-[color:var(--fg-secondary)] px-1">
        <span className="font-semibold text-[color:var(--accent-dark)]">{headline}</span>
        {" — "}
        <span className="text-emerald-700">✓ 通過 {passed.length}件</span>
        {failed.length > 0 && (
          <>
            {" / "}
            <span className="text-red-700">✗ 落選 {failed.length}件</span>
          </>
        )}
      </div>

      {/* KD=0 が多い場合は警告 (Backlinks サブスク失効 or API障害の疑い) */}
      {kdZeroCount > 0 && kdTotalCount > 0 && kdZeroCount / kdTotalCount >= 0.5 && (
        <div className="text-[10px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1.5">
          ⚠ KD=0 が {kdZeroCount}/{kdTotalCount}件。Backlinks サブスクの有効期限切れ
          または DataForSEO API 障害の可能性があります。
        </div>
      )}

      {passed.length > 0 && (
        <StageItemList items={passed} variant="pass" />
      )}
      {failed.length > 0 && (
        <StageItemList items={failed} variant="fail" />
      )}
    </div>
  );
}

function StageItemList({ items, variant }: { items: StageItem[]; variant: "pass" | "fail" }) {
  const headerBg =
    variant === "pass"
      ? "bg-emerald-50/60 border-emerald-200/60"
      : "bg-red-50/60 border-red-200/60";
  const icon = variant === "pass" ? "✓" : "✗";
  const iconCls = variant === "pass" ? "text-emerald-700" : "text-red-600";
  return (
    <ul className={`space-y-1 rounded-lg border ${headerBg} p-2`}>
      {items.map((it, idx) => (
        <li
          key={`${variant}-${idx}-${it.kw}`}
          className="text-[11px] flex items-start gap-2 p-1.5 rounded bg-white"
        >
          <span className={`shrink-0 font-bold ${iconCls}`}>{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[12px] truncate text-[color:var(--fg-primary)]">
              {it.kw}
            </div>
            <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5 flex flex-wrap gap-x-2">
              {it.intent && <span>intent={it.intent}</span>}
              {/* KD は常に表示 (null / undefined のときは「-」 / 取得失敗の可能性を併記) */}
              <span
                className={
                  it.kd === 0
                    ? "text-orange-600"
                    : typeof it.kd === "number" && it.kd > 30
                      ? "text-red-600"
                      : typeof it.kd === "number"
                        ? "text-emerald-700"
                        : ""
                }
                title={
                  it.kd === 0
                    ? "KD=0 は取得失敗の可能性 (DFS Backlinks 未契約)"
                    : typeof it.kd === "number" && it.kd > 30
                      ? "KD>30 = 上位表示困難"
                      : typeof it.kd === "number"
                        ? "KD≤30 = 狙い目"
                        : "未取得"
                }
              >
                KD={typeof it.kd === "number" ? it.kd : "-"}
              </span>
              {typeof it.searchVolume === "number" && (
                <span>SV={it.searchVolume.toLocaleString("ja-JP")}</span>
              )}
              {typeof it.cpc === "number" && <span>CPC=¥{Math.round(it.cpc * 150)}</span>}
              {it.competitionLevel && <span>競合={it.competitionLevel}</span>}
              {it.searchIntent && <span>dfs={it.searchIntent}</span>}
            </div>
            {variant === "pass" && it.reason && (
              <div className="text-[10px] text-[color:var(--fg-secondary)] mt-0.5">
                💡 {it.reason}
              </div>
            )}
            {variant === "fail" && it.rejectionNote && (
              <div className="text-[10px] text-[color:var(--fg-secondary)] mt-0.5">
                💬 {it.rejectionNote}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
