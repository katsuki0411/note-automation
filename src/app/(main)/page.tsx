"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedIdea, FeedState, ThemeId } from "@/lib/types";
import { THEMES } from "@/lib/types";
import type { HotKeyword } from "@/lib/hotKeywords";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { FilterBar, GroupTab, FilterPill } from "@/components/FilterBar";
import { useGeneration } from "@/components/GenerationProvider";
import { useProject } from "@/components/ProjectContext";
import { getCache, setCache } from "@/lib/clientCache";

const CACHE_KEY = "research:feed";
const HOT_CACHE_KEY = "research:hotKeywords";

type HotCache = {
  keywords: HotKeyword[];
  updatedAt: string | null;
  stats: HotStats | null;
};

const POLL_INTERVAL_MS = 30 * 1000; // 30sec
const DAILY_FIRE_HOUR = 9; // JST 9時に1日1回tick

function nextDailyFireAt(): number {
  const d = new Date();
  d.setHours(DAILY_FIRE_HOUR, 0, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

const THEME_LABEL: Record<ThemeId, string> = Object.fromEntries(
  THEMES.map((t) => [t.id, t.label]),
) as Record<ThemeId, string>;

type SortMode = "score" | "newest" | "pain";
type GroupBy = "theme" | "source" | "keyword" | "free";
type HotStats = {
  candidatesTotal: number;
  verified: number;
  noHits: number;
  searchFailed: number;
};
// filter: "all" | "fresh" | "high-score" | "theme:<id>" | "source:<platform>" | "keyword:<kw>"

// amazon_affiliate / a8_affiliate プロジェクトでは「ネタ収集 & 生成」画面は使わないため、
// / 直アクセス時に kind 別の初期画面 (/bestsellers) に飛ばす wrapper。
// 内部の ResearchPageInner はそのままの巨大コンポーネント。
export default function ResearchPage() {
  const router = useRouter();
  const project = useProject();
  const needsRedirect =
    project.kind === "amazon_affiliate" || project.kind === "a8_affiliate";
  useEffect(() => {
    if (needsRedirect) router.replace("/bestsellers");
  }, [needsRedirect, router]);
  if (needsRedirect) return null;
  return <ResearchPageInner />;
}

function ResearchPageInner() {
  const { enqueue, state: genState } = useGeneration();
  const cachedFeed = getCache<FeedState>(CACHE_KEY);
  const [state, setState] = useState<FeedState>(cachedFeed ?? { ideas: [], tickCount: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("source");
  const [filter, setFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [paused, setPaused] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nextTickAt, setNextTickAt] = useState<number>(nextDailyFireAt());
  const [now, setNow] = useState(Date.now());
  const [tickError, setTickError] = useState<string | null>(null);
  const [freeTheme, setFreeTheme] = useState("");
  const cachedHot = getCache<HotCache>(HOT_CACHE_KEY);
  const [hotKeywords, setHotKeywords] = useState<HotKeyword[]>(cachedHot?.keywords ?? []);
  const [hotUpdatedAt, setHotUpdatedAt] = useState<string | null>(cachedHot?.updatedAt ?? null);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotError, setHotError] = useState<string | null>(null);
  const [hotStats, setHotStats] = useState<HotStats | null>(cachedHot?.stats ?? null);
  const [hotFilter, setHotFilter] = useState<string>("all");
  const [expandedHot, setExpandedHot] = useState<Set<string>>(new Set());
  const [researchingKw, setResearchingKw] = useState<string | null>(null);
  const hotFetched = useRef(false);

  // ユーザーがお題指定で実際に入力して取得したネタの id 集合 (localStorage で永続化)。
  // ホットキーワード研究も裏側で mode:"free" を使うため、データ上は区別できない。
  // クライアント側で id を持っておくことで「ユーザー自身が指定したもの」のみを抽出する。
  const [userFreeIds, setUserFreeIds] = useState<Set<string>>(new Set());

  const initialFetched = useRef(false);
  const [initialLoaded, setInitialLoaded] = useState(cachedFeed !== undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("note-automation:userFreeIds");
    if (!stored) return;
    try {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) {
        setUserFreeIds(new Set(arr.filter((s): s is string => typeof s === "string")));
      }
    } catch {
      /* ignore parse error */
    }
  }, []);

  const persistUserFreeIds = useCallback((ids: Set<string>) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("note-automation:userFreeIds", JSON.stringify([...ids]));
  }, []);

  const refreshFeed = useCallback(async () => {
    const res = await fetch("/api/feed", { cache: "no-store" });
    if (res.ok) {
      const next: FeedState = await res.json();
      setState(next);
      setCache(CACHE_KEY, next);
    }
    setInitialLoaded(true);
  }, []);

  const tick = useCallback(
    async (body?: object) => {
      if (ticking) return;
      setTicking(true);
      setTickError(null);
      try {
        const res = await fetch("/api/feed/tick", {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "失敗");
        await refreshFeed();
      } catch (e) {
        setTickError(e instanceof Error ? e.message : "失敗");
      } finally {
        setTicking(false);
        setNextTickAt(nextDailyFireAt());
      }
    },
    [refreshFeed, ticking],
  );

  /** お題指定モード専用の送信。tick との違いは「追加されたネタ id を
   *  ユーザー由来として localStorage に記録する」点。 */
  const submitFreeTheme = useCallback(
    async (theme: string) => {
      if (!theme.trim() || ticking) return;
      setTicking(true);
      setTickError(null);
      try {
        const res = await fetch("/api/feed/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "free", theme: theme.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "失敗");
        const added: FeedIdea[] = Array.isArray(data.addedIdeas) ? data.addedIdeas : [];
        if (added.length > 0) {
          setUserFreeIds((prev) => {
            const next = new Set(prev);
            for (const idea of added) next.add(idea.id);
            persistUserFreeIds(next);
            return next;
          });
        }
        await refreshFeed();
      } catch (e) {
        setTickError(e instanceof Error ? e.message : "失敗");
      } finally {
        setTicking(false);
        setNextTickAt(nextDailyFireAt());
      }
    },
    [refreshFeed, ticking, persistUserFreeIds],
  );

  // 初回フェッチ（空でも自動tickはしない・1日1回9時にしか走らない）
  useEffect(() => {
    if (initialFetched.current) return;
    initialFetched.current = true;
    refreshFeed();
  }, [refreshFeed]);

  // tick auto loop（毎日9時に1回）
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (Date.now() >= nextTickAt) tick();
    }, 30000);
    return () => clearInterval(id);
  }, [paused, nextTickAt, tick]);

  // poll feed (others may have written)
  useEffect(() => {
    const id = setInterval(refreshFeed, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshFeed]);

  // countdown clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const list = state.ideas.filter((i) => {
      if (filter === "all") return true;
      if (filter === "fresh") {
        const age = Date.now() - new Date(i.createdAt).getTime();
        return age < 60 * 60 * 1000;
      }
      if (filter === "high-score") return (i.priorityScore ?? 0) >= 70;
      if (filter.startsWith("theme:")) return i.themeId === filter.slice(6);
      if (filter.startsWith("source:")) return (i.voice?.platform ?? "") === filter.slice(7);
      return true;
    });
    const sorted = [...list];
    if (sortMode === "score") {
      sorted.sort(
        (a, b) =>
          (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } else if (sortMode === "pain") {
      sorted.sort(
        (a, b) =>
          (b.target?.painIntensity ?? 0) - (a.target?.painIntensity ?? 0) ||
          (b.priorityScore ?? 0) - (a.priorityScore ?? 0),
      );
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [state.ideas, filter, sortMode]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function expandAll() {
    if (groupBy === "keyword") {
      setExpandedHot(new Set(hotKeywords.map((h) => h.kw)));
    } else {
      setExpanded(new Set(filtered.map((i) => i.id)));
    }
  }

  function collapseAll() {
    if (groupBy === "keyword") {
      setExpandedHot(new Set());
    } else {
      setExpanded(new Set());
    }
  }

  function toggleExpandHot(kw: string) {
    const next = new Set(expandedHot);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    setExpandedHot(next);
  }

  function proceed() {
    const picked = state.ideas.filter((i) => selected.has(i.id));
    if (picked.length === 0) return;
    enqueue(picked);
    setSelected(new Set());
  }

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of state.ideas) {
      const p = i.voice?.platform?.trim();
      if (!p) continue;
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [state.ideas]);

  const fetchHotKeywords = useCallback(async () => {
    const res = await fetch("/api/keywords/hot", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      updatedAt: string | null;
      keywords: HotKeyword[];
      stats?: HotStats;
    };
    const next: HotCache = {
      keywords: data.keywords ?? [],
      updatedAt: data.updatedAt,
      stats: data.stats ?? null,
    };
    setHotKeywords(next.keywords);
    setHotUpdatedAt(next.updatedAt);
    setHotStats(next.stats);
    setCache(HOT_CACHE_KEY, next);
  }, []);

  const refreshHotKeywords = useCallback(async () => {
    if (hotLoading) return;
    setHotLoading(true);
    setHotError(null);
    try {
      const res = await fetch("/api/keywords/hot", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      const next: HotCache = {
        keywords: data.keywords ?? [],
        updatedAt: data.updatedAt,
        stats: data.stats ?? null,
      };
      setHotKeywords(next.keywords);
      setHotUpdatedAt(next.updatedAt);
      setHotStats(next.stats);
      setCache(HOT_CACHE_KEY, next);
    } catch (e) {
      setHotError(e instanceof Error ? e.message : "失敗");
    } finally {
      setHotLoading(false);
    }
  }, [hotLoading]);

  const researchHotKeyword = useCallback(
    async (kw: string, opts?: { autoGenerate?: boolean }) => {
      if (researchingKw) return;
      setResearchingKw(kw);
      setTickError(null);
      try {
        const res = await fetch("/api/feed/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "free", theme: kw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "失敗");
        await refreshFeed();

        if (opts?.autoGenerate) {
          const added: FeedIdea[] = Array.isArray(data.addedIdeas) ? data.addedIdeas : [];
          if (added.length === 0) {
            setTickError("ネタが見つかりませんでした（記事生成スキップ）");
          } else {
            const top = [...added].sort(
              (a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0),
            )[0];
            enqueue([top]);
          }
        }
      } catch (e) {
        setTickError(e instanceof Error ? e.message : "失敗");
      } finally {
        setResearchingKw(null);
      }
    },
    [researchingKw, refreshFeed, enqueue],
  );

  function selectGroup(g: GroupBy) {
    setGroupBy(g);
    setFilter("all");
    setHotFilter("all");
    if (g === "keyword" && !hotFetched.current) {
      hotFetched.current = true;
      fetchHotKeywords();
    }
  }

  const sortedHotKeywords = useMemo(() => {
    let list = [...hotKeywords];
    if (hotFilter.startsWith("src:")) {
      const target = hotFilter.slice(4);
      list = list.filter((h) => (h.sources ?? []).some((s) => s === target));
    }
    if (sortMode === "score") {
      list.sort(
        (a, b) =>
          b.priority - a.priority ||
          new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime(),
      );
    } else if (sortMode === "newest") {
      list.sort(
        (a, b) =>
          new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime() ||
          b.priority - a.priority,
      );
    } else if (sortMode === "pain") {
      list.sort(
        (a, b) =>
          (b.painIntensity ?? 3) - (a.painIntensity ?? 3) || b.priority - a.priority,
      );
    }
    return list;
  }, [hotKeywords, hotFilter, sortMode]);

  const hotSourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hotKeywords) {
      for (const s of h.sources ?? []) {
        const key = s.trim();
        if (!key) continue;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [hotKeywords]);

  const generatedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of genState.completed) ids.add(c.id);
    return ids;
  }, [genState.completed]);

  const inFlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (genState.current) ids.add(genState.current.id);
    for (const q of genState.queue) ids.add(q.id);
    return ids;
  }, [genState.current, genState.queue]);

  async function dismiss(id: string) {
    await fetch("/api/feed", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    refreshFeed();
  }

  const remainMs = Math.max(0, nextTickAt - now);
  const remainH = Math.floor(remainMs / 3600000);
  const remainM = Math.floor((remainMs % 3600000) / 60000);
  const nextFireDate = new Date(nextTickAt);
  const isToday = nextFireDate.toDateString() === new Date(now).toDateString();

  return (
    <>
      <PageHeader
        title="ライブネタフィード"
        description="主婦のリアルな悩みをGeminiが定期的に発掘します。気になるネタにチェックを入れて記事生成へ。"
        right={
          <>
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-full border border-[var(--border-card)] bg-white text-[12px]">
              {paused ? (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
              ) : ticking ? (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
              )}
              <span className="font-mono tabular-nums text-[color:var(--fg-secondary)]">
                {paused
                  ? "PAUSED"
                  : ticking
                    ? "FETCHING…"
                    : `次は${isToday ? "今日" : "明日"} 9:00 (残り ${remainH}h${String(remainM).padStart(2, "0")}m)`}
              </span>
            </div>
            <button onClick={tick} disabled={ticking} className="btn-ghost">
              今すぐ更新
            </button>
            <button onClick={() => setPaused((p) => !p)} className="btn-ghost">
              {paused ? "再開" : "一時停止"}
            </button>
          </>
        }
      >
      <FilterBar>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px">
            <GroupTab active={groupBy === "source"} onClick={() => selectGroup("source")}>
              公式サイト別 <span className="opacity-60 ml-0.5">{sourceCounts.length}</span>
            </GroupTab>
            <GroupTab active={groupBy === "keyword"} onClick={() => selectGroup("keyword")}>
              キーワード別
              {hotKeywords.length > 0 && (
                <span className="opacity-60 ml-0.5">{hotKeywords.length}</span>
              )}
            </GroupTab>
            <GroupTab active={groupBy === "free"} onClick={() => selectGroup("free")}>
              <span className="text-[color:var(--accent)] mr-0.5">+</span>お題指定
            </GroupTab>
          </div>
          {groupBy === "free" ? (
            <div className="text-[11px] font-mono text-[color:var(--fg-muted)]">
              {state.ideas.filter((i) => userFreeIds.has(i.id)).length} CUSTOM
            </div>
          ) : groupBy !== "keyword" ? (
            <div className="text-[11px] font-mono text-[color:var(--fg-muted)]">
              TICK #{state.tickCount}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {hotStats && (
                <span className="text-[11px] text-[color:var(--fg-muted)]">
                  候補{hotStats.candidatesTotal}件中{" "}
                  <span className="text-emerald-700 font-semibold">
                    {hotStats.verified}件ヒット
                  </span>
                </span>
              )}
              <button
                onClick={refreshHotKeywords}
                disabled={hotLoading}
                className="btn-ghost text-[11px] px-3 py-1.5"
              >
                {hotLoading
                  ? "発掘＋検証中…"
                  : hotUpdatedAt
                    ? "🔄 再発掘"
                    : "🔥 ホットキーワードを発掘"}
              </button>
            </div>
          )}
        </div>
        {groupBy === "free" && (
          <div className="flex gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <input
              value={freeTheme}
              onChange={(e) => setFreeTheme(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && freeTheme.trim() && !ticking) {
                  submitFreeTheme(freeTheme.trim());
                  setFreeTheme("");
                }
              }}
              placeholder="例: 夏休み 自由研究 / 運動会 弁当 / 七五三 着付け"
              className="flex-1 px-4 py-2.5 rounded-full border border-[var(--border-card)] bg-white text-[13px] focus:outline-none focus:border-[color:var(--accent)] transition"
              autoFocus
            />
            <button
              onClick={() => {
                submitFreeTheme(freeTheme.trim());
                setFreeTheme("");
              }}
              disabled={!freeTheme.trim() || ticking}
              className="btn-primary"
            >
              探す →
            </button>
          </div>
        )}
        {groupBy !== "keyword" && groupBy !== "free" && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
                すべて <span className="opacity-60 ml-1">{state.ideas.length}</span>
              </FilterPill>
              <FilterPill active={filter === "fresh"} onClick={() => setFilter("fresh")}>
                新着1h
              </FilterPill>
              <FilterPill
                active={filter === "high-score"}
                onClick={() => setFilter("high-score")}
              >
                ⭐ 高スコア(70+)
              </FilterPill>
              <span className="mx-1 w-px h-5 bg-[var(--border-subtle)]" />
              {groupBy === "source" &&
                (sourceCounts.length === 0 ? (
                  <span className="text-[12px] text-[color:var(--fg-muted)] italic">
                    ネタ元情報がまだありません
                  </span>
                ) : (
                  sourceCounts.map(([platform, count]) => {
                    const v = `source:${platform}`;
                    return (
                      <FilterPill
                        key={platform}
                        active={filter === v}
                        onClick={() => setFilter(v)}
                      >
                        {platform} <span className="opacity-60 ml-1">{count}</span>
                      </FilterPill>
                    );
                  })
                ))}
            </div>
          </div>
        )}
        {groupBy === "keyword" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterPill active={hotFilter === "all"} onClick={() => setHotFilter("all")}>
              すべて <span className="opacity-60 ml-1">{hotKeywords.length}</span>
            </FilterPill>
            {hotSourceCounts.length > 0 && (
              <span className="mx-1 w-px h-5 bg-[var(--border-subtle)]" />
            )}
            {hotSourceCounts.map(([src, count]) => {
              const v = `src:${src}`;
              return (
                <FilterPill
                  key={src}
                  active={hotFilter === v}
                  onClick={() => setHotFilter(v)}
                >
                  {src} <span className="opacity-60 ml-1">{count}</span>
                </FilterPill>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mr-1">
              SORT
            </span>
            <SortPill active={sortMode === "score"} onClick={() => setSortMode("score")}>
              スコア順
            </SortPill>
            <SortPill active={sortMode === "newest"} onClick={() => setSortMode("newest")}>
              新着順
            </SortPill>
            <SortPill active={sortMode === "pain"} onClick={() => setSortMode("pain")}>
              悩みの深さ順
            </SortPill>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={expandAll}
              className="text-[11px] text-[color:var(--fg-secondary)] hover:text-[color:var(--accent-dark)] underline-offset-2 hover:underline"
            >
              全て展開
            </button>
            <span className="text-[color:var(--fg-muted)] text-[10px]">/</span>
            <button
              onClick={collapseAll}
              className="text-[11px] text-[color:var(--fg-secondary)] hover:text-[color:var(--accent-dark)] underline-offset-2 hover:underline"
            >
              全て閉じる
            </button>
          </div>
        </div>
      </FilterBar>
      </PageHeader>

      {tickError && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
          更新失敗: {tickError}
        </p>
      )}

      {hotError && groupBy === "keyword" && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
          {hotError}
        </p>
      )}

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="ネタフィードを読み込み中…" fill={false} />
        </div>
      ) : groupBy === "free" ? (
        (() => {
          const customIdeas = filtered.filter((i) => userFreeIds.has(i.id));
          if (customIdeas.length === 0) {
            return (
              <div className="card p-12 text-center">
                {ticking ? (
                  <>
                    <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3">
                      FETCHING…
                    </div>
                    <div className="space-y-2 max-w-md mx-auto">
                      <div className="h-3 rounded-full shimmer" />
                      <div className="h-3 rounded-full shimmer" style={{ width: "82%" }} />
                      <div className="h-3 rounded-full shimmer" style={{ width: "65%" }} />
                    </div>
                  </>
                ) : (
                  <p className="text-[color:var(--fg-secondary)]">
                    まだお題指定で探したネタがありません。上の入力欄にテーマを入れて「探す→」を押してください。
                  </p>
                )}
              </div>
            );
          }
          return (
            <div className="grid gap-2 pb-28">
              {customIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  selected={selected.has(idea.id)}
                  expanded={expanded.has(idea.id)}
                  generated={generatedIds.has(idea.id)}
                  inFlight={inFlightIds.has(idea.id)}
                  onToggle={() => toggle(idea.id)}
                  onToggleExpand={() => toggleExpand(idea.id)}
                  onDismiss={() => dismiss(idea.id)}
                  onSingleGenerate={() => enqueue([idea])}
                />
              ))}
            </div>
          );
        })()
      ) : groupBy === "keyword" ? (
        sortedHotKeywords.length === 0 ? (
          <div className="card p-12 text-center">
            {hotLoading ? (
              <>
                <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3">
                  発掘＋検証中…（候補40件 → 各KWを実検索でヒット確認）
                </div>
                <div className="space-y-2 max-w-md mx-auto">
                  <div className="h-3 rounded-full shimmer" />
                  <div className="h-3 rounded-full shimmer" style={{ width: "82%" }} />
                  <div className="h-3 rounded-full shimmer" style={{ width: "65%" }} />
                </div>
              </>
            ) : hotKeywords.length === 0 ? (
              <p className="text-[color:var(--fg-secondary)]">
                ホットキーワード未取得です。右上の「🔥 ホットキーワードを発掘」を押してください。
              </p>
            ) : (
              <p className="text-[color:var(--fg-secondary)]">
                該当キーワードがありません。フィルターを変更してください。
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-2 pb-28">
            {sortedHotKeywords.map((h) => (
              <HotKeywordCard
                key={h.kw}
                hot={h}
                expanded={expandedHot.has(h.kw)}
                isResearching={researchingKw === h.kw}
                onToggleExpand={() => toggleExpandHot(h.kw)}
                onResearch={() => researchHotKeyword(h.kw)}
                onAutoGenerate={() => researchHotKeyword(h.kw, { autoGenerate: true })}
              />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          {ticking ? (
            <>
              <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3">
                FETCHING…
              </div>
              <div className="space-y-2 max-w-md mx-auto">
                <div className="h-3 rounded-full shimmer" />
                <div className="h-3 rounded-full shimmer" style={{ width: "82%" }} />
                <div className="h-3 rounded-full shimmer" style={{ width: "65%" }} />
              </div>
            </>
          ) : (
            <p className="text-[color:var(--fg-secondary)]">
              ネタがまだありません。「今すぐ更新」を押すか、5分待ってください。
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2 pb-28">
          {filtered.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              selected={selected.has(idea.id)}
              expanded={expanded.has(idea.id)}
              generated={generatedIds.has(idea.id)}
              inFlight={inFlightIds.has(idea.id)}
              onToggle={() => toggle(idea.id)}
              onToggleExpand={() => toggleExpand(idea.id)}
              onDismiss={() => dismiss(idea.id)}
              onSingleGenerate={() => enqueue([idea])}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20">
          <div
            className="flex items-center gap-3 px-5 py-3 rounded-full bg-[color:var(--black)] text-white shadow-2xl"
            style={{ boxShadow: "0 20px 40px -12px rgba(0,0,0,0.35)" }}
          >
            <span className="text-[13px]">
              選択中 <span className="font-mono tabular-nums">{selected.size}</span> 件
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[12px] opacity-60 hover:opacity-100"
            >
              クリア
            </button>
            <button
              onClick={proceed}
              className="ml-2 px-4 py-1.5 rounded-full bg-[color:var(--accent)] text-white text-[13px] font-semibold hover:bg-[color:var(--accent-dark)] transition"
            >
              記事生成スタート →
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function HotKeywordCard({
  hot,
  expanded,
  isResearching,
  onToggleExpand,
  onResearch,
  onAutoGenerate,
}: {
  hot: HotKeyword;
  expanded: boolean;
  isResearching: boolean;
  onToggleExpand: () => void;
  onResearch: () => void;
  onAutoGenerate: () => void;
}) {
  const themeLabel = THEME_LABEL[hot.themeId] ?? hot.themeId;
  const ageMs = Date.now() - new Date(hot.discoveredAt).getTime();
  const isFresh = ageMs < 60 * 60 * 1000;
  const ageLabel = formatAge(ageMs);

  const { text: whyText, extracted } = stripSourcesFromText(hot.whyHot ?? "");
  const sources = Array.from(new Set([...(hot.sources ?? []), ...extracted]));

  return (
    <div
      className={`card overflow-hidden transition-colors ${
        isResearching
          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
          : "card-hover"
      }`}
    >
      <div
        onClick={onToggleExpand}
        className="flex items-center px-3 md:px-4 py-3 gap-2 md:gap-3 cursor-pointer select-none"
      >
        <ScoreBadge score={hot.priority} />
        <span
          className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-[color:var(--fg-secondary)] shrink-0 max-w-[80px] md:max-w-[160px] truncate"
          title={themeLabel}
        >
          {themeLabel}
        </span>
        {hot.painIntensity && (
          <div className="hidden md:block">
            <PainBadge intensity={hot.painIntensity} />
          </div>
        )}
        <h3 className="flex-1 min-w-0 font-semibold text-[13.5px] md:text-[14.5px] tracking-tight truncate text-[color:var(--fg-primary)]">
          {hot.kw}
        </h3>
        <div className="hidden md:contents">
        <RiseBadge status={hot.riseStatus} />
        <VerifyBadge hot={hot} />
        </div>
        <span
          className="hidden md:inline-flex items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
          style={(() => {
            const palette: Record<string, { background: string; color: string }> = {
              high: { background: "#dcfce7", color: "#15803d" },
              medium: { background: "#fef3c7", color: "#92400e" },
              low: { background: "#fee2e2", color: "#991b1b" },
              niche: { background: "#e0e7ff", color: "#3730a3" },
            };
            return palette[hot.volumeHint] ?? palette.medium;
          })()}
          title={`検索Vol: ${hot.volumeHint}`}
        >
          検{hot.volumeHint}
        </span>
        {isFresh && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--accent-dark)] shrink-0">
            <span className="w-1 h-1 rounded-full bg-[color:var(--accent)]" />
            NEW
          </span>
        )}
        <span className="text-[10px] font-mono text-[color:var(--fg-muted)] shrink-0 hidden sm:inline">
          {ageLabel}
        </span>
        {isResearching ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-white text-[10.5px] font-bold shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            実行中
          </span>
        ) : (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResearch();
              }}
              className="px-2.5 py-1 rounded-full bg-white border border-[var(--border-card)] text-[color:var(--fg-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent-dark)] text-[10.5px] font-medium transition"
              title="このキーワードでネタ収集を実行（フィードに5件追加）"
            >
              🔍 ネタ収集
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAutoGenerate();
              }}
              className="px-2.5 py-1 rounded-full bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent-dark)] text-[10.5px] font-bold transition"
              title="ネタ収集 → 最高スコアを自動選択 → 記事生成まで一気に実行"
            >
              🪄 一気書き
            </button>
          </div>
        )}
        <ChevronIcon expanded={expanded} />
      </div>

      {expanded && (
        <div className="px-6 pb-5 border-t border-[var(--border-subtle)] grid lg:grid-cols-[1fr_300px] gap-6">
          <div className="pt-4 space-y-4">
            {whyText && (
              <section>
                <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                  WHY HOT · 今熱い理由
                </div>
                <p className="text-[13px] leading-relaxed text-[color:var(--fg-primary)]">
                  {whyText}
                </p>
              </section>
            )}
            {hot.sampleUrls && hot.sampleUrls.length > 0 && (
              <section>
                <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                  SAMPLE URLS · 実ヒット投稿
                </div>
                <ul className="space-y-1">
                  {hot.sampleUrls.map((url, i) => (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11.5px] text-[color:var(--accent-dark)] hover:underline truncate inline-block max-w-full"
                      >
                        ↗ {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <aside className="pt-4 lg:border-l lg:pl-6 border-[var(--border-subtle)] space-y-4 text-[11px]">
            <section>
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                SRC · 実ヒットしたサイト
              </div>
              {sources.length === 0 ? (
                <span className="text-[10.5px] text-[color:var(--fg-muted)] italic">
                  未取得
                </span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {sources.map((s, i) => {
                    const p = platformPalette(s);
                    return (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: p.bg, color: p.fg }}
                      >
                        {s}
                      </span>
                    );
                  })}
                </div>
              )}
            </section>
            <section>
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                METRICS
              </div>
              <div className="space-y-1.5">
                <Stat label="検索Vol" value={hot.volumeHint} />
                <Stat label="競合" value={hot.competitionHint} />
                <div className="flex items-center gap-2">
                  <span className="text-[color:var(--fg-muted)] w-14 shrink-0">勢い</span>
                  <RiseBadge status={hot.riseStatus} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[color:var(--fg-muted)] w-14 shrink-0">意図</span>
                  <span className="text-[10.5px] text-[color:var(--fg-secondary)]">
                    {INTENT_LABEL[hot.intent] ?? hot.intent}
                  </span>
                </div>
                {hot.verifiedHits !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="text-[color:var(--fg-muted)] w-14 shrink-0">検証</span>
                    <VerifyBadge hot={hot} />
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

const INTENT_LABEL: Record<string, string> = {
  info: "情報収集",
  "how-to": "やり方",
  comparison: "比較",
  trouble: "トラブル解決",
};

function RiseBadge({ status }: { status: HotKeyword["riseStatus"] }) {
  const conf =
    status === "rising"
      ? { bg: "#fee2e2", fg: "#991b1b", icon: "↑", label: "上昇中" }
      : status === "declining"
        ? { bg: "#e0e7ff", fg: "#3730a3", icon: "↓", label: "下降中" }
        : { bg: "#f3f4f6", fg: "#374151", icon: "→", label: "安定" };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0"
      style={{ background: conf.bg, color: conf.fg }}
      title={`勢い: ${conf.label}`}
    >
      {conf.icon} {status}
    </span>
  );
}

function VerifyBadge({ hot }: { hot: HotKeyword }) {
  if (hot.verifyStatus === "verified" && (hot.verifiedHits ?? 0) > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 shrink-0"
        title={`実検索で ${hot.verifiedHits} 件ヒット（許可ドメイン内）`}
      >
        ✓ {hot.verifiedHits}件
      </span>
    );
  }
  if (hot.verifyStatus === "no-hits") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-gray-100 text-gray-500 shrink-0"
        title="実検索でヒットなし（需要が薄い可能性）"
      >
        0件
      </span>
    );
  }
  if (hot.verifyStatus === "search-failed") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800 shrink-0"
        title="検索プロバイダ未設定/失敗のため未検証"
      >
        未検証
      </span>
    );
  }
  return null;
}

const SortPill = FilterPill;

function IdeaCard({
  idea,
  selected,
  expanded,
  generated,
  inFlight,
  onToggle,
  onToggleExpand,
  onDismiss,
  onSingleGenerate,
}: {
  idea: FeedIdea;
  selected: boolean;
  expanded: boolean;
  generated: boolean;
  inFlight: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
  onDismiss: () => void;
  onSingleGenerate: () => void;
}) {
  const ageMs = Date.now() - new Date(idea.createdAt).getTime();
  const isFresh = ageMs < 30 * 60 * 1000;
  const ageLabel = formatAge(ageMs);

  return (
    <div
      className={`card overflow-hidden transition-colors ${
        selected
          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
          : "card-hover"
      }`}
    >
      {/* 折りたたみヘッダー（常時表示） */}
      <div
        onClick={onToggleExpand}
        className="flex items-center px-4 py-3 gap-3 cursor-pointer select-none"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`w-5 h-5 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0 transition ${
            selected ? "bg-[color:var(--accent)]" : "border-2 border-[var(--border-card)] bg-white hover:border-[color:var(--accent)]"
          }`}
          title={selected ? "選択解除" : "選択"}
        >
          {selected ? "✓" : ""}
        </button>
        {typeof idea.priorityScore === "number" && (
          <ScoreBadge score={idea.priorityScore} />
        )}
        <span
          className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-[color:var(--fg-secondary)] shrink-0 max-w-[80px] md:max-w-[160px] truncate"
          title={idea.customLabel ?? THEME_LABEL[idea.themeId] ?? idea.themeId}
        >
          {idea.sourceMode === "derivative" && "↳ "}
          {idea.customLabel ?? THEME_LABEL[idea.themeId] ?? idea.themeId}
        </span>
        {idea.target?.painIntensity && (
          <div className="hidden md:block">
            <PainBadge intensity={idea.target.painIntensity} />
          </div>
        )}
        <h3 className="flex-1 min-w-0 font-semibold text-[13.5px] md:text-[14.5px] tracking-tight truncate text-[color:var(--fg-primary)]">
          {idea.title}
        </h3>
        {idea.voice && (
          <span className="hidden md:inline shrink-0">
            <PlatformBadge platform={idea.voice.platform} />
          </span>
        )}
        {idea.impression && (
          <div className="hidden md:block">
            <MiniMetrics impression={idea.impression} />
          </div>
        )}
        {generated && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] text-[10px] font-bold shrink-0">
            ✓ 記事完成
          </span>
        )}
        {inFlight && !generated && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold shrink-0">
            <span className="w-1 h-1 rounded-full bg-amber-600 animate-pulse" />
            生成キュー
          </span>
        )}
        {isFresh && (
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-[color:var(--accent-dark)] shrink-0">
            <span className="w-1 h-1 rounded-full bg-[color:var(--accent)]" />
            NEW
          </span>
        )}
        <span className="text-[10px] font-mono text-[color:var(--fg-muted)] shrink-0 hidden sm:inline">
          {ageLabel}
        </span>
        <ChevronIcon expanded={expanded} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="text-[color:var(--fg-muted)] hover:text-red-500 text-lg leading-none px-1 shrink-0"
          title="非表示"
        >
          ×
        </button>
      </div>

      {!expanded && <ExpandedDetailHidden />}

      {/* 展開時のみ表示する本体 */}
      {expanded && (
      <div className="grid lg:grid-cols-[1fr_340px] gap-0 border-t border-[var(--border-subtle)]">
        {/* 左: VOICE → PROPOSAL */}
        <div className="px-6 pb-6 lg:border-r border-[var(--border-subtle)]">
          {/* VOICE */}
          <section>
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
              VOICE · 元ネタ
            </div>
            {idea.voice ? (
              <>
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  <PlatformBadge platform={idea.voice.platform} />
                  {idea.voice.context && (
                    <span className="text-[10px] text-[color:var(--fg-muted)]">
                      {idea.voice.context}
                    </span>
                  )}
                </div>
                <div className="relative pl-4 border-l-2 border-[color:var(--accent)]">
                  <p className="text-[14px] leading-relaxed text-[color:var(--fg-primary)]">
                    「{idea.voice.quote}」
                  </p>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    {idea.voice.url && (
                      <a
                        href={idea.voice.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[color:var(--accent-dark)] hover:underline truncate"
                        title={idea.voice.url}
                      >
                        直接リンク ↗
                      </a>
                    )}
                    <SearchProviderBadge provider={idea.voice.searchProvider} />
                  </div>
                  <GenerateButton
                    generated={generated}
                    inFlight={inFlight}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSingleGenerate();
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[12px] text-[color:var(--fg-muted)] italic">元ネタ情報なし</p>
            )}
          </section>

          <div className="hairline my-5" />

          {/* PROPOSAL */}
          <section>
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
              PROPOSAL · 記事案
            </div>
            <h3 className="font-bold text-[18px] tracking-tight leading-snug">
              {idea.title}
            </h3>
            <p className="text-[13px] mt-2 text-[color:var(--fg-secondary)] leading-relaxed">
              {idea.hook}
            </p>
            {idea.toolConcept && (
              <div className="mt-3 p-3.5 rounded-lg bg-[color:var(--black)] text-white">
                <div className="text-[10px] font-mono tracking-widest text-white/50 mb-1">
                  TOOL CONCEPT
                </div>
                <div className="text-[12.5px] leading-relaxed">{idea.toolConcept}</div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="px-2.5 py-1 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] font-medium">
                {idea.angle}
              </span>
            </div>
          </section>
        </div>

        {/* 右: KEYWORDS → TARGET → IMPRESSION 縦積み */}
        <aside className="px-6 pb-6 pt-1 bg-gray-50/40 text-[11px] flex flex-col gap-4 lg:gap-0 lg:divide-y lg:divide-[var(--border-subtle)]">
          {idea.keywords && (
            <div className="lg:py-4 lg:first:pt-2">
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                KEYWORDS
              </div>
              <div className="mb-2">
                <span className="px-2.5 py-1 rounded-md bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] font-bold text-[12px]">
                  {idea.keywords.primary}
                </span>
              </div>
              {idea.keywords.secondary.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {idea.keywords.secondary.map((s, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded bg-white border border-[var(--border-subtle)] text-[10.5px] text-[color:var(--fg-secondary)]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {idea.keywords.longTail.length > 0 && (
                <ul className="text-[color:var(--fg-muted)] space-y-0.5">
                  {idea.keywords.longTail.slice(0, 4).map((k, i) => (
                    <li key={i} className="text-[10.5px] before:content-['→'] before:mr-1.5 before:text-[color:var(--accent)]">
                      {k}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {idea.target && (
            <div className="lg:py-4">
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                TARGET
              </div>
              <div className="text-[color:var(--fg-primary)] mb-2 leading-relaxed">
                {idea.target.persona}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {idea.target.ageRange && (
                  <span className="px-2 py-0.5 rounded-full bg-white border border-[var(--border-subtle)] text-[10px] text-[color:var(--fg-secondary)]">
                    {idea.target.ageRange}
                  </span>
                )}
                {idea.target.familyStatus && (
                  <span className="px-2 py-0.5 rounded-full bg-white border border-[var(--border-subtle)] text-[10px] text-[color:var(--fg-secondary)]">
                    {idea.target.familyStatus}
                  </span>
                )}
              </div>
            </div>
          )}
          {idea.impression && (
            <div className="lg:py-4 lg:last:pb-2">
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
                IMPRESSION · 見込み
              </div>
              <div className="space-y-1.5">
                <Stat
                  label="検索Vol"
                  value={idea.impression.monthlySearchVolume}
                  detail={idea.impression.monthlySearchVolumeNote}
                />
                <Stat label="競合" value={idea.impression.competitionLevel} />
                <Stat
                  label="noteポテ"
                  value={idea.impression.notePotential}
                  detail={idea.impression.notePotentialReason}
                />
                {idea.impression.reachEstimateMonthly && (
                  <div className="text-[10.5px] text-[color:var(--fg-secondary)] pt-1.5 border-t border-[var(--border-subtle)] mt-1">
                    <span className="text-[color:var(--fg-muted)]">月間予想 reach:</span>{" "}
                    <span className="font-semibold text-[color:var(--fg-primary)]">
                      {idea.impression.reachEstimateMonthly}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {idea.impression?.notePotentialReason && (
            <div className="lg:py-3 text-[10.5px] text-[color:var(--fg-muted)] italic">
              💡 {idea.impression.notePotentialReason}
            </div>
          )}
        </aside>
      </div>
      )}
    </div>
  );
}

function ExpandedDetailHidden() {
  return null;
}

function MiniMetrics({
  impression,
}: {
  impression: NonNullable<FeedIdea["impression"]>;
}) {
  return (
    <div className="hidden md:flex items-center gap-0.5 shrink-0">
      <MiniChip label="検" value={impression.monthlySearchVolume} />
      <MiniChip label="競" value={impression.competitionLevel} />
      <MiniChip label="ポ" value={impression.notePotential} />
    </div>
  );
}

function MiniChip({ label, value }: { label: string; value: string }) {
  const palette = (() => {
    if (value === "high") return { bg: "#dcfce7", fg: "#15803d", txt: "高" };
    if (value === "medium") return { bg: "#fef3c7", fg: "#92400e", txt: "中" };
    if (value === "low") return { bg: "#fee2e2", fg: "#991b1b", txt: "低" };
    if (value === "niche") return { bg: "#e0e7ff", fg: "#3730a3", txt: "ニ" };
    return { bg: "#f3f4f6", fg: "#374151", txt: "?" };
  })();
  const fullLabel: Record<string, string> = {
    検: "検索Vol",
    競: "競合",
    ポ: "noteポテ",
  };
  const fullValue: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
    niche: "ニッチ",
  };
  return (
    <span
      className="inline-flex items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded"
      style={{ background: palette.bg, color: palette.fg }}
      title={`${fullLabel[label]}: ${fullValue[value] ?? value}`}
    >
      <span className="opacity-60 mr-0.5">{label}</span>
      {palette.txt}
    </span>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`shrink-0 w-4 h-4 text-[color:var(--fg-muted)] transition-transform ${
        expanded ? "rotate-180" : ""
      }`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let cls = "bg-gray-100 text-gray-600";
  if (score >= 80) cls = "bg-[color:var(--accent)] text-white";
  else if (score >= 65) cls = "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]";
  else if (score >= 50) cls = "bg-amber-100 text-amber-800";
  else cls = "bg-gray-100 text-gray-500";
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tabular-nums ${cls}`}
      title={`総合スコア ${score}/100`}
    >
      ★{score}
    </span>
  );
}

function PainBadge({ intensity }: { intensity: 1 | 2 | 3 | 4 | 5 }) {
  const palette =
    intensity >= 4
      ? { bg: "#fee2e2", fg: "#991b1b" }
      : intensity === 3
        ? { bg: "#ffedd5", fg: "#9a3412" }
        : { bg: "#f3f4f6", fg: "#4b5563" };
  const filled = "●".repeat(intensity);
  const empty = "○".repeat(5 - intensity);
  return (
    <span
      className="inline-flex items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ background: palette.bg, color: palette.fg }}
      title={`悩みの深さ ${intensity}/5（5=毎日泣きそう / 1=軽い不便）`}
    >
      <span className="opacity-60 mr-0.5">悩</span>
      <span className="tracking-tighter">{filled}</span>
      <span className="tracking-tighter opacity-25">{empty}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  const palette = (() => {
    if (value === "high") return { bg: "#dcfce7", fg: "#15803d" };
    if (value === "medium") return { bg: "#fef3c7", fg: "#92400e" };
    if (value === "low") return { bg: "#fee2e2", fg: "#991b1b" };
    if (value === "niche") return { bg: "#e0e7ff", fg: "#3730a3" };
    return { bg: "#f3f4f6", fg: "#374151" };
  })();
  const labelMap: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
    niche: "ニッチ",
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[color:var(--fg-muted)] w-14 shrink-0">{label}</span>
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
        style={{ background: palette.bg, color: palette.fg }}
        title={detail}
      >
        {labelMap[value] ?? value}
      </span>
      {detail && label !== "noteポテ" && (
        <span className="text-[10px] text-[color:var(--fg-muted)] truncate" title={detail}>
          {detail}
        </span>
      )}
    </div>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const palette = platformPalette(platform);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ background: palette.bg, color: palette.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.fg }} />
      {platform}
    </span>
  );
}

function GenerateButton({
  generated,
  inFlight,
  onClick,
}: {
  generated: boolean;
  inFlight: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (generated) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] text-[11px] font-bold shrink-0">
        ✓ 記事完成
      </span>
    );
  }
  if (inFlight) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
        生成中
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-3.5 py-1 rounded-full bg-[color:var(--accent)] text-white text-[11px] font-bold shrink-0 hover:bg-[color:var(--accent-dark)] active:scale-95 transition"
      title="この1件を即座に記事生成"
    >
      ✏️ 記事生成
    </button>
  );
}

function SearchProviderBadge({
  provider,
}: {
  provider?: "brave" | "google" | "ai";
}) {
  if (!provider) return null;
  const palette = {
    brave: { bg: "#fb542b", fg: "#ffffff", label: "Brave Search", icon: "🦁" },
    google: { bg: "#4285f4", fg: "#ffffff", label: "Google Search", icon: "G" },
    ai: { bg: "#fef3c7", fg: "#92400e", label: "AI再構成", icon: "🤖" },
  }[provider];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
      style={{ background: palette.bg, color: palette.fg }}
      title={
        provider === "ai"
          ? "Geminiが検索結果から再構成（実投稿と一致しない可能性）"
          : `${palette.label}で発掘`
      }
    >
      <span>{palette.icon}</span>
      via {palette.label.split(" ")[0]}
    </span>
  );
}

function platformPalette(platform: string): { bg: string; fg: string } {
  const p = platform.toLowerCase();
  if (p.includes("知恵袋") || p.includes("yahoo")) return { bg: "#fff3d6", fg: "#a25700" };
  if (p.includes("ガール") || p.includes("girl")) return { bg: "#ffe1ec", fg: "#a8005c" };
  if (p.includes("ママスタ")) return { bg: "#ffe7d6", fg: "#a04000" };
  if (p.includes("ウィメンズ")) return { bg: "#f3e5ff", fg: "#5b1d8a" };
  if (p.includes("5ch") || p.includes("既婚")) return { bg: "#e0f0e0", fg: "#1f5b1f" };
  if (p.includes("twitter") || p === "x" || p.includes("(x)")) return { bg: "#e7e9ec", fg: "#15202b" };
  if (p.includes("threads")) return { bg: "#eaeaea", fg: "#101010" };
  if (p.includes("instagram")) return { bg: "#fde4ef", fg: "#a8327a" };
  if (p.includes("教えて") || p.includes("goo") || p.includes("okwave")) return { bg: "#dff1ff", fg: "#0a4d8c" };
  if (p.includes("mixi")) return { bg: "#fff4d6", fg: "#856200" };
  if (p.includes("line")) return { bg: "#dff6e3", fg: "#0a6e26" };
  if (p.includes("reddit")) return { bg: "#ffe5dc", fg: "#a13d1d" };
  return { bg: "#eef0f3", fg: "#3d4451" };
}

const SOURCE_ALIASES: { canonical: string; patterns: RegExp[] }[] = [
  { canonical: "Yahoo知恵袋", patterns: [/Yahoo!?\s*知恵袋/gi, /知恵袋/g] },
  { canonical: "ガルちゃん", patterns: [/ガールズちゃんねる/g, /ガルちゃん/g] },
  { canonical: "ママスタ", patterns: [/ママスタ(?:BBS|セレクト)?/gi] },
  { canonical: "ウィメンズパーク", patterns: [/ウィメンズ(?:パーク)?/gi] },
  { canonical: "5ch既婚女性板", patterns: [/5ch(?:既婚女性板)?/gi, /既婚女性板/g] },
  { canonical: "X", patterns: [/(?<![A-Za-z])X\(?旧Twitter\)?/g, /旧Twitter/gi, /Twitter/gi] },
  { canonical: "Threads", patterns: [/Threads/gi] },
  { canonical: "Instagram", patterns: [/Instagram/gi, /インスタ(?:グラム)?/g] },
  { canonical: "教えてgoo", patterns: [/教えて!?goo/gi, /OKWAVE/gi] },
  { canonical: "mixi", patterns: [/mixi/gi] },
  { canonical: "Reddit", patterns: [/Reddit/gi] },
];

function stripSourcesFromText(text: string): { text: string; extracted: string[] } {
  if (!text) return { text: "", extracted: [] };
  const found = new Set<string>();
  let cleaned = text;
  for (const { canonical, patterns } of SOURCE_ALIASES) {
    for (const re of patterns) {
      if (re.test(cleaned)) {
        found.add(canonical);
        cleaned = cleaned.replace(re, "");
      }
    }
  }
  cleaned = cleaned
    .replace(/[「『]\s*[」』]/g, "")
    .replace(/[、,]\s*[、,]/g, "、")
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/\s*[/／]\s*(?=[、。)）」])/g, "")
    .replace(/^[\s、,。.\/／]+|[\s、,\/／]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: cleaned, extracted: [...found] };
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}
