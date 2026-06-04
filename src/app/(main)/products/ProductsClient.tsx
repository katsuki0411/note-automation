"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";
import { useGeneration } from "@/components/GenerationProvider";
import { getCache, setCache } from "@/lib/clientCache";
import type { Article, FeedIdea } from "@/lib/types";
import {
  PLATFORM_LABELS,
  getPlatformFaviconUrl,
  type Platform,
  type PostingDestinationRow,
} from "@/lib/posters/types";

const CACHE_SUBJECT = "products:subject";
const CACHE_RESULT = "products:result";
const CACHE_IDEIZED = "products:ideized";

type AIScores = {
  authority: number;
  intentGap: number;
  blogRoom: number;
  llmoAffinity: number;
  mediaMix: number;
  overall: number;
  rationale: string;
};

type DestinationStatus = {
  destinationId: string;
  platform: string;
  label: string;
  platformLabel: string;
  occupied: boolean;     // true = 既に競合記事あり / false = 未投稿の隙間
  hits: number;          // 上位10件中の該当 platform 記事数
  promptReady?: boolean; // true = プロンプト設定済で記事生成可 / false = プロンプト未設定
};

type ScoutCandidate = {
  kw: string;
  intent: string;
  reason: string;
  seoDifficulty: "easy" | "medium" | "hard";
  opportunityScore: number;
  rationale: string;
  buckets: {
    big_ec: number;
    big_media: number;
    individual_blog: number;
    other: number;
  };
  totalScanned: number;
  topUrls: string[];
  ai?: AIScores;
  destinationStatus?: DestinationStatus[];
};

type ScoutResponse = {
  subject: string;
  candidateCount: number;
  candidates: ScoutCandidate[];
  historyId?: string;
};

type HistoryItem = {
  id: string;
  subject: string;
  category: string | null;
  candidate_count: number;
  created_at: string;
};

const DIFF_BADGE: Record<ScoutCandidate["seoDifficulty"], { text: string; cls: string }> = {
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
  // タブ: 新規スカウト / 履歴一覧 / 採用KW (記事生成済み KW)
  const [tab, setTab] = useState<"new" | "history" | "adopted">("new");
  // 採用KW タブ用: scout 由来 (customLabel = "🛒 ..." or destinationId あり) の articles
  const [adoptedArticles, setAdoptedArticles] = useState<Article[]>([]);
  const [adoptedLoading, setAdoptedLoading] = useState(false);
  const [destinations, setDestinations] = useState<PostingDestinationRow[]>([]);
  // 履歴ジャンルフィルタ ("" = すべて表示)
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<string>("");
  const [backfilling, setBackfilling] = useState(false);
  // Ahrefs 精査結果 (KWごと)
  const [ahrefsMetrics, setAhrefsMetrics] = useState<
    Record<string, { kd: number | null; vol: number | null; cpc: number | null }>
  >({});
  const [refining, setRefining] = useState<Set<string>>(new Set());

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

  // 履歴 / 採用KW タブ時のみ body のスクロールを止める。これでページ全体がスクロールせず
  // カラム内 overflow-y-auto と sticky ヘッダがちゃんと機能する
  useEffect(() => {
    if (tab !== "history" && tab !== "adopted") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [tab]);

  // 採用KW タブ表示時に articles + destinations をロード
  useEffect(() => {
    if (tab !== "adopted") return;
    setAdoptedLoading(true);
    Promise.all([
      fetch("/api/articles").then((r) => r.json()),
      fetch("/api/destinations").then((r) => r.json()),
    ])
      .then(([articlesData, destsData]) => {
        const all: Article[] = articlesData.articles ?? [];
        // scout 由来 = idea.customLabel が "🛒 " で始まる、または destinationId が紐付いていて
        //  amazon系 idea (themeId が "custom" 等) のもの。amazon_affiliate プロジェクト想定。
        const scoutOnly = all.filter((a) => {
          const cl = (a.idea as FeedIdea)?.customLabel?.trim();
          return cl?.startsWith("🛒") ?? false;
        });
        setAdoptedArticles(scoutOnly);
        setDestinations(destsData.destinations ?? []);
      })
      .catch(() => {})
      .finally(() => setAdoptedLoading(false));
  }, [tab]);

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
  //   1. プロンプト未設定の destination は除外 (記事生成不可)
  //   2. 占有あり (= 競合あり) も避ける、なければ占有あり強行
  //   3. note 優先、なければ最初の候補
  // 結果を「note: OK / はてな: プロンプトなし → スキップ」のような形でユーザーに見せる
  async function generateFromCandidate(c: ScoutCandidate) {
    let targetDestId: string | undefined;

    if (c.destinationStatus && c.destinationStatus.length > 0) {
      // プロンプト設定済 + 未占有の destination が「OK 候補」
      const promptReadyList = c.destinationStatus.filter((s) => s.promptReady);
      const okCandidates = promptReadyList.filter((s) => !s.occupied);

      // ユーザー向けに各 destination の状態を集計表示
      const summary = c.destinationStatus
        .map((s) => {
          if (!s.promptReady) return `❌ ${s.platformLabel}: プロンプトなし → スキップ`;
          if (s.occupied) return `⚠ ${s.platformLabel}: 競合${s.hits}件 (上位10位)`;
          return `✅ ${s.platformLabel}: OK (記事生成候補)`;
        })
        .join("\n");

      if (promptReadyList.length === 0) {
        alert(
          `❌ 全ての投稿先でプロンプト未設定のため記事生成できません。\n\n${summary}\n\n設定 → 投稿先 → 各行の「プロンプト」ボタンから先にプロンプトを設定してください。`,
        );
        return;
      }

      if (okCandidates.length === 0) {
        // プロンプトはあるが全て競合あり → 確認の上で強行
        const preferred =
          promptReadyList.find((s) => s.platform === "note") ?? promptReadyList[0];
        if (
          !confirm(
            `${summary}\n\nプロンプト設定済の投稿先は全て競合ありです。それでも「${preferred.platformLabel}」で記事生成しますか?`,
          )
        ) {
          return;
        }
        targetDestId = preferred.destinationId;
      } else {
        // note 優先、なければ最初の OK 候補
        const preferred =
          okCandidates.find((s) => s.platform === "note") ?? okCandidates[0];
        targetDestId = preferred.destinationId;

        // プロンプトなしでスキップされる destination があれば軽くお知らせ
        if (promptReadyList.length < c.destinationStatus.length) {
          // alert を出すと毎回確認させて煩いので、生成は進めつつ、コンソール記録 + フラッシュ表示
          // (アラート出したい場合は下の confirm に変える)
          console.info(`[generate] selected ${preferred.platformLabel}\n${summary}`);
        }
      }
    }

    setGenerating((s) => new Set([...s, c.kw]));
    try {
      const idea = await ideizeCandidate(c);
      if (!idea) throw new Error("ideaの生成に失敗しました");
      enqueue([idea], targetDestId);
      setIdeized((s) => new Set([...s, c.kw]));
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
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px">
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
              {adoptedArticles.length > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({adoptedArticles.length})</span>
              )}
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
          tab === "history" || tab === "adopted"
            ? "md:sticky md:top-0 md:h-[calc(100vh-140px)] md:overflow-hidden md:-mt-8 -mt-6 -mx-4 md:-mx-8 px-2 md:px-4"
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
            ⚠ 1回あたり Gemini × 1 / Brave Search × 25〜30 呼ばれます (Brave 無料枠 2,000req/月、月60回前後スカウト可)
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
                  <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center">
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
                  </div>
                  {/* スクロール領域 (この部分だけスクロールバー表示) */}
                  <div className="flex-1 overflow-y-auto pr-2 mt-2 min-h-0">
                  <ul className="space-y-2">
                    {result.candidates.map((c, i) => {
                      const diff = DIFF_BADGE[c.seoDifficulty];
                      const isOpen = expanded.has(i);
                      const isIdeized = ideized.has(c.kw);
                      return (
                        <li
                          key={i}
                          className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${diff.cls}`}>
                                  {diff.text}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                  機会 {c.opportunityScore}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                                  {INTENT_LABEL[c.intent] ?? c.intent}
                                </span>
                              </div>
                              <div className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                                {c.kw}
                              </div>
                              <div className="text-[11px] text-[color:var(--fg-muted)] mt-0.5">
                                {c.reason}
                              </div>
                              <div className="text-[11px] text-[color:var(--fg-secondary)] mt-1.5 leading-snug">
                                📊 {c.rationale}
                              </div>
                              <div className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                                上位{c.totalScanned}件:
                                EC {c.buckets.big_ec} / 比較メディア {c.buckets.big_media} /
                                個人ブログ {c.buckets.individual_blog} / その他 {c.buckets.other}
                              </div>
                              {ahrefsMetrics[c.kw] && (
                                <div className="mt-2 p-2 rounded bg-orange-50 border border-orange-100">
                                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                    <span className="font-mono text-orange-700 font-semibold">
                                      🔬 Ahrefs
                                    </span>
                                    {ahrefsMetrics[c.kw].kd !== null && (
                                      <span className="text-[color:var(--fg-secondary)]">
                                        KD <strong>{ahrefsMetrics[c.kw].kd}</strong>
                                      </span>
                                    )}
                                    {ahrefsMetrics[c.kw].vol !== null && (
                                      <span className="text-[color:var(--fg-secondary)]">
                                        月Vol <strong>{ahrefsMetrics[c.kw].vol?.toLocaleString("ja-JP")}</strong>
                                      </span>
                                    )}
                                    {ahrefsMetrics[c.kw].cpc !== null && (
                                      <span className="text-[color:var(--fg-secondary)]">
                                        CPC <strong>${ahrefsMetrics[c.kw].cpc?.toFixed(2)}</strong>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                              {c.ai && (
                                <div className="mt-2 p-2 rounded bg-purple-50 border border-purple-100">
                                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                    <span className="font-mono text-purple-700 font-semibold">
                                      🤖 AI 総合 {c.ai.overall}
                                    </span>
                                    <span className="text-[color:var(--fg-muted)]">
                                      権威 {c.ai.authority} / intent欠 {c.ai.intentGap} / blog余地 {c.ai.blogRoom} / LLMO {c.ai.llmoAffinity} / mediaMix {c.ai.mediaMix}
                                    </span>
                                  </div>
                                  {c.ai.rationale && (
                                    <div className="text-[10px] text-[color:var(--fg-secondary)] mt-1 leading-snug">
                                      💡 {c.ai.rationale}
                                    </div>
                                  )}
                                </div>
                              )}
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
                              {isOpen && c.topUrls.length > 0 && (
                                <ul className="mt-2 space-y-0.5 pl-4">
                                  {c.topUrls.map((u, j) => (
                                    <li key={j} className="text-[10px] text-[color:var(--fg-muted)] truncate">
                                      {j + 1}. <a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => toggleExpand(i)}
                                className="text-[10px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                              >
                                {isOpen ? "閉じる" : "URL"}
                              </button>
                              <button
                                type="button"
                                onClick={() => refineKw(c.kw)}
                                disabled={refining.has(c.kw)}
                                className="text-[10px] px-2 py-1 rounded whitespace-nowrap bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-wait"
                                title="Ahrefs で KD/検索Vol/CPC を取得 (50 units 消費)"
                              >
                                {refining.has(c.kw) ? "⏳" : ahrefsMetrics[c.kw] ? "🔬 再精査" : "🔬 Ahrefs精査"}
                              </button>
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
                                {isIdeized ? "✓ ネタ化済" : "ネタ化"}
                              </button>
                              <button
                                type="button"
                                onClick={() => generateFromCandidate(c)}
                                disabled={generating.has(c.kw)}
                                className="text-[10px] px-2 py-1 rounded whitespace-nowrap bg-[color:var(--accent)] hover:opacity-80 text-white disabled:opacity-50 disabled:cursor-wait"
                                title="ネタ化と同時に記事生成キューに投入"
                              >
                                {generating.has(c.kw) ? "投入中…" : "✍ 記事生成"}
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="text-[11px] text-[color:var(--fg-muted)] mt-3">
                    「ネタ化」したKWは <Link href="/" className="text-[color:var(--accent-dark)] hover:underline">ライブフィード</Link> に追加されます。そこから記事生成へ。
                  </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "new" && busy && (
          <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-gray-50 text-center text-[13px] text-[color:var(--fg-secondary)]">
            ⏳ 関連KW生成 → Brave 検索で各KWの上位10件を分析中…<br />
            <span className="text-[11px] text-[color:var(--fg-muted)]">
              1〜2分かかる場合があります
            </span>
          </div>
        )}

        {/* 採用KW タブ: scout 由来 (idea.customLabel が "🛒 *") で記事生成された article 一覧。
            カラム内スクロール (KWスカウト履歴と同じパターン) で 1カラムにカードを並べる */}
        {tab === "adopted" && (
          <div className="flex flex-col md:h-full min-h-0">
            <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center justify-between">
              <div className="text-[12px] text-[color:var(--fg-secondary)]">
                記事生成済みの KW: <strong>{adoptedArticles.length}</strong> 件
              </div>
              <div className="text-[10px] text-[color:var(--fg-muted)] font-mono">
                KW スカウト → 記事生成 を実行したもの
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 mt-3 min-h-0">
              {adoptedLoading ? (
                <div className="text-[12px] text-[color:var(--fg-muted)] py-4">読み込み中…</div>
              ) : adoptedArticles.length === 0 ? (
                <div className="p-8 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                  <p className="text-[13px] text-[color:var(--fg-secondary)]">
                    採用KWはまだありません
                  </p>
                  <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
                    「スカウト履歴」タブの候補カードから ✍記事生成 を押すと、ここに表示されます
                  </p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {adoptedArticles.map((a) => {
                    const fi = a.idea as FeedIdea;
                    // KW 本体 = idea.title (スカウト時に取得した本来のキーワード)
                    // スカウト元の商品名 (subject) は customLabel の "🛒 ..." から復元
                    const kw = a.idea.title;
                    const sourceSubject = fi?.customLabel?.replace(/^🛒\s*/, "")?.trim();
                    const dest = destinations.find((d) => d.id === a.destinationId);
                    const platform = dest?.platform as Platform | undefined;
                    return (
                      <li
                        key={a.id}
                        className="p-4 rounded-xl border border-[var(--border-card)] bg-white hover:border-gray-400 transition flex flex-col gap-2.5"
                      >
                        <div>
                          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1">
                            KEYWORD
                          </div>
                          <div className="text-[14px] font-semibold leading-snug line-clamp-2">
                            {kw}
                          </div>
                          {sourceSubject && (
                            <div className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                              🛒 {sourceSubject}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          {platform && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={getPlatformFaviconUrl(platform)}
                                alt=""
                                className="w-3 h-3 rounded-sm"
                                loading="lazy"
                              />
                              {PLATFORM_LABELS[platform] ?? platform}
                            </span>
                          )}
                          {a.postedAt ? (
                            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                              ✓ 投稿済
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                              ⏳ 未投稿
                            </span>
                          )}
                          <span className="font-mono text-[color:var(--fg-muted)] ml-auto">
                            {new Date(a.createdAt).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <Link
                          href={`/library?id=${a.id}`}
                          className="text-center text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 transition"
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

      </div>
    </>
  );
}
