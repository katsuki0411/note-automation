"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Article, FeedIdea, ThemeId } from "@/lib/types";
import { THEMES } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { getCache, setCache } from "@/lib/clientCache";
import { postToNote, type NotePostResult } from "@/lib/notePost";
import { PLATFORM_LABELS, type Platform, type PostingDestinationRow } from "@/lib/posters/types";
import { useProject } from "@/components/ProjectContext";

const CACHE_KEY = "library:articles";
const SELECTED_KW_CACHE_KEY = "library:selectedKw";
const SELECTED_DEST_CACHE_KEY = "library:selectedDest";

// project.kind に応じて空状態の文言とリンク先を切替
function EmptyLibraryCta() {
  const project = useProject();
  let href = "/";
  let label = "① ネタ収集から始める";
  if (project.kind === "amazon_affiliate" || project.kind === "a8_affiliate") {
    href = "/bestsellers";
    label = "① ベストセラーから探す";
  }
  return (
    <div className="card p-12 text-center">
      <div className="text-5xl mb-4 opacity-30">∅</div>
      <p className="text-[color:var(--fg-secondary)] mb-5">まだ記事がありません。</p>
      <Link href={href} className="btn-primary inline-block">
        {label}
      </Link>
    </div>
  );
}

const THEME_LABEL: Record<string, string> = Object.fromEntries(
  THEMES.map((t) => [t.id, t.label]),
);

function feedIdeaOf(a: Article): FeedIdea | null {
  const idea = a.idea as Partial<FeedIdea>;
  return idea && (idea.themeId || idea.voice || idea.customLabel)
    ? (idea as FeedIdea)
    : null;
}

// destination.prompt_config に「実際に書かれた値」が1つでもあれば true
function isPromptReady(d: PostingDestinationRow): boolean {
  const pc = d.prompt_config as Record<string, unknown> | null | undefined;
  return (
    !!pc &&
    Object.values(pc).some((v) => typeof v === "string" && v.trim().length > 0)
  );
}

// KW のグルーピングキー。同じネタ (idea) なら destination 違いでも同じ KW として束ねる
function keywordKeyOf(a: Article): string {
  const fi = feedIdeaOf(a);
  return fi?.targetKeywordId ?? a.idea?.title ?? a.id;
}
function keywordLabelOf(a: Article): string {
  const fi = feedIdeaOf(a);
  return fi?.customLabel?.trim() || a.idea?.title || "(無題)";
}

type KeywordGroup = {
  key: string;
  label: string;
  themeId?: ThemeId;
  latestCreatedAt: string;
  articles: Article[]; // この KW で生成された記事 (destination 違いの全件)
};

export default function LibraryPage() {
  const cached = getCache<Article[]>(CACHE_KEY);
  const cachedKw = getCache<string | null>(SELECTED_KW_CACHE_KEY);
  const cachedDest = getCache<string | null>(SELECTED_DEST_CACHE_KEY);
  const [articles, setArticles] = useState<Article[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);

  const [selectedKwKey, setSelectedKwKeyState] = useState<string | null>(cachedKw ?? null);
  const [selectedDestinationId, setSelectedDestinationIdState] = useState<string | null>(
    cachedDest ?? null,
  );
  const setSelectedKwKey = useCallback((k: string | null) => {
    setSelectedKwKeyState(k);
    setCache(SELECTED_KW_CACHE_KEY, k);
  }, []);
  const setSelectedDestinationId = useCallback((id: string | null) => {
    setSelectedDestinationIdState(id);
    setCache(SELECTED_DEST_CACHE_KEY, id);
  }, []);

  const [genreFilter, setGenreFilter] = useState<string>("all"); // themeId | "all"
  const [kwSearch, setKwSearch] = useState<string>("");

  const [copied, setCopied] = useState<string | null>(null);
  const [derivativeStatus, setDerivativeStatus] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message?: string;
  }>({ state: "idle" });
  const [imageStatus, setImageStatus] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message?: string;
  }>({ state: "idle" });

  // 未生成サイト用「このサイト用に生成」ボタンの状態
  const [generateForSiteState, setGenerateForSiteState] = useState<{
    state: "idle" | "loading" | "error";
    message?: string;
  }>({ state: "idle" });

  // マルチポストモーダル
  const [postModalArticle, setPostModalArticle] = useState<Article | null>(null);
  const [postTagsInput, setPostTagsInput] = useState("");
  const [postPublish, setPostPublish] = useState(true);
  const [postStatus, setPostStatus] = useState<{
    state: "idle" | "sending" | "done" | "error";
    message?: string;
  }>({ state: "idle" });
  const [destinations, setDestinations] = useState<PostingDestinationRow[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  // 本文編集モード
  const [editingBody, setEditingBody] = useState(false);
  const [editingBodyDraft, setEditingBodyDraft] = useState("");
  const [editingBodySaving, setEditingBodySaving] = useState(false);
  const [editingBodyError, setEditingBodyError] = useState<string | null>(null);

  // ---------- データロード ----------
  useEffect(() => {
    fetch("/api/destinations")
      .then((r) => r.json())
      .then((d) => setDestinations(d.destinations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // ?id=xxx で来た場合 (投稿レコード等から) はその記事の KW × destination を選択
    const urlId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("id")
        : null;
    fetch("/api/articles")
      .then((r) => r.json())
      .then((d) => {
        const next: Article[] = d.articles ?? [];
        setArticles(next);
        setCache(CACHE_KEY, next);
        if (urlId) {
          const hit = next.find((a) => a.id === urlId);
          if (hit) {
            setSelectedKwKey(keywordKeyOf(hit));
            if (hit.destinationId) setSelectedDestinationId(hit.destinationId);
          }
        }
      })
      .finally(() => setInitialLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 集約 ----------
  const allGenres = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      const t = feedIdeaOf(a)?.themeId;
      if (!t) continue;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [articles]);

  const keywordGroups = useMemo<KeywordGroup[]>(() => {
    const map = new Map<string, KeywordGroup>();
    for (const a of articles) {
      if (genreFilter !== "all") {
        if (feedIdeaOf(a)?.themeId !== genreFilter) continue;
      }
      const k = keywordKeyOf(a);
      const label = keywordLabelOf(a);
      const exist = map.get(k);
      if (exist) {
        exist.articles.push(a);
        if (a.createdAt > exist.latestCreatedAt) exist.latestCreatedAt = a.createdAt;
      } else {
        map.set(k, {
          key: k,
          label,
          themeId: feedIdeaOf(a)?.themeId,
          latestCreatedAt: a.createdAt,
          articles: [a],
        });
      }
    }
    const groups = [...map.values()].sort(
      (a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt),
    );
    if (kwSearch.trim()) {
      const q = kwSearch.trim().toLowerCase();
      return groups.filter((g) => g.label.toLowerCase().includes(q));
    }
    return groups;
  }, [articles, genreFilter, kwSearch]);

  // 選択中 KW の整合性チェック (フィルター変更で消えたら先頭に振り直す)
  useEffect(() => {
    if (keywordGroups.length === 0) {
      if (selectedKwKey !== null) setSelectedKwKey(null);
      return;
    }
    if (!selectedKwKey || !keywordGroups.find((g) => g.key === selectedKwKey)) {
      setSelectedKwKey(keywordGroups[0].key);
    }
  }, [keywordGroups, selectedKwKey, setSelectedKwKey]);

  const currentGroup = useMemo(
    () => keywordGroups.find((g) => g.key === selectedKwKey) ?? null,
    [keywordGroups, selectedKwKey],
  );

  // サイトタブ候補: enabled な destination (note を最初に持ってくる)
  const siteTabs = useMemo(() => {
    const list = destinations
      .filter((d) => d.enabled)
      .slice()
      .sort((a, b) => {
        if (a.platform === "note" && b.platform !== "note") return -1;
        if (a.platform !== "note" && b.platform === "note") return 1;
        return a.label.localeCompare(b.label);
      });
    return list;
  }, [destinations]);

  // 選択中 destination の整合性チェック
  useEffect(() => {
    if (siteTabs.length === 0) return;
    if (
      !selectedDestinationId ||
      !siteTabs.find((d) => d.id === selectedDestinationId)
    ) {
      setSelectedDestinationId(siteTabs[0].id);
    }
  }, [siteTabs, selectedDestinationId, setSelectedDestinationId]);

  // 選択中 KW × 選択中 destination の article (なければ null = 未生成)
  const currentArticle = useMemo<Article | null>(() => {
    if (!currentGroup || !selectedDestinationId) return null;
    return (
      currentGroup.articles.find((a) => a.destinationId === selectedDestinationId) ??
      null
    );
  }, [currentGroup, selectedDestinationId]);

  const currentFeed = currentArticle ? feedIdeaOf(currentArticle) : null;

  // ---------- マルチポストモーダル制御 ----------
  function openPostModal(a: Article) {
    const fi = feedIdeaOf(a);
    const suggestedTags: string[] = [];
    if (fi?.keywords?.primary) suggestedTags.push(fi.keywords.primary);
    if (fi?.keywords?.secondary) suggestedTags.push(...fi.keywords.secondary);
    setPostTagsInput(suggestedTags.slice(0, 5).join(", "));
    setPostPublish(true);
    setPostStatus({ state: "idle" });
    const init = new Set<string>(["note"]);
    destinations
      .filter((d) => d.enabled && isPromptReady(d))
      .forEach((d) => init.add(d.id));
    setSelectedTargets(init);
    setEditingBody(false);
    setEditingBodyDraft(a.bodyMarkdown ?? "");
    setEditingBodyError(null);
    setEditingBodySaving(false);
    setPostModalArticle(a);
  }

  async function saveEditedBody() {
    if (!postModalArticle) return;
    if (editingBodyDraft === postModalArticle.bodyMarkdown) {
      setEditingBody(false);
      return;
    }
    setEditingBodySaving(true);
    setEditingBodyError(null);
    try {
      const res = await fetch(`/api/articles/${postModalArticle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: editingBodyDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
      const updated: Article = data.article;
      setPostModalArticle(updated);
      setArticles((prev) => {
        const next = prev.map((a) => (a.id === updated.id ? updated : a));
        setCache(CACHE_KEY, next);
        return next;
      });
      setEditingBody(false);
    } catch (e) {
      setEditingBodyError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setEditingBodySaving(false);
    }
  }

  function toggleTarget(id: string) {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closePostModal() {
    if (postStatus.state === "sending") return;
    setPostModalArticle(null);
  }

  async function submitPost() {
    if (!postModalArticle) return;
    if (selectedTargets.size === 0) {
      setPostStatus({ state: "error", message: "投稿先を1つ以上選んでください" });
      return;
    }
    const tags = postTagsInput
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);
    setPostStatus({ state: "sending", message: "投稿中…" });

    const noteSelected = selectedTargets.has("note");
    const destIds = [...selectedTargets].filter((t) => t !== "note");
    const messages: string[] = [];
    let hasError = false;

    if (destIds.length > 0) {
      try {
        const res = await fetch("/api/multipost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleId: postModalArticle.id,
            destinationIds: destIds,
            draft: !postPublish,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "失敗");
        const results = (data.results ?? []) as Array<{
          ok: boolean;
          destinationLabel?: string;
          platform?: string;
          url?: string;
          error?: string;
        }>;
        for (const r of results) {
          if (r.ok) {
            messages.push(`✅ ${r.destinationLabel}: ${r.url ? "投稿完了 → " + r.url : "投稿完了"}`);
          } else {
            hasError = true;
            messages.push(`❌ ${r.destinationLabel ?? r.platform}: ${r.error}`);
          }
        }
      } catch (e) {
        hasError = true;
        messages.push(`❌ multipost API: ${e instanceof Error ? e.message : "失敗"}`);
      }
    }

    if (noteSelected) {
      const res: NotePostResult = await postToNote({
        title: postModalArticle.bestTitle,
        body: postModalArticle.bodyMarkdown,
        tags,
        publish: postPublish,
        imageUrl: postModalArticle.imagePath,
      });
      if (res.ok) {
        messages.push(
          postPublish
            ? "✅ note: 公開ボタン押下まで送信"
            : "✅ note: 下書きに入力完了",
        );
        try {
          await fetch("/api/articles/posted", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ articleId: postModalArticle.id }),
          });
        } catch {}
      } else {
        hasError = true;
        messages.push(`❌ note: ${res.error ?? "失敗"}`);
      }
    }

    const articleId = postModalArticle.id;
    const nowIso = new Date().toISOString();
    setArticles((prev) => {
      const next = prev.map((a) =>
        a.id === articleId ? { ...a, postedAt: a.postedAt ?? nowIso } : a,
      );
      setCache(CACHE_KEY, next);
      return next;
    });

    setPostStatus({
      state: hasError ? "error" : "done",
      message: messages.join("\n"),
    });
  }

  // ---------- 画像 / 派生 / コピー / 未生成サイト用生成 ----------
  async function generateImage(articleId: string) {
    setImageStatus({ state: "loading", message: "Nano Banana で生成中（約10〜20秒）..." });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      setArticles((prev) => {
        const next = prev.map((a) =>
          a.id === articleId ? { ...a, imagePath: data.imagePath as string } : a,
        );
        setCache(CACHE_KEY, next);
        return next;
      });
      setImageStatus({ state: "done", message: "見出し画像を生成しました" });
      setTimeout(() => setImageStatus({ state: "idle" }), 3000);
    } catch (e) {
      clearTimeout(timeout);
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "90秒経過してもサーバーから応答がありませんでした。Vercelのログ確認をおすすめします。"
            : e.message
          : "失敗";
      setImageStatus({ state: "error", message: msg });
      setTimeout(() => setImageStatus({ state: "idle" }), 8000);
    }
  }

  async function generateDerivative(articleId: string) {
    setDerivativeStatus({ state: "loading", message: "派生案を発掘中..." });
    try {
      const res = await fetch("/api/feed/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "derivative", articleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      setDerivativeStatus({
        state: "done",
        message: `${data.added}件の派生案をフィードに追加しました`,
      });
      setTimeout(() => setDerivativeStatus({ state: "idle" }), 4000);
    } catch (e) {
      setDerivativeStatus({
        state: "error",
        message: e instanceof Error ? e.message : "失敗",
      });
      setTimeout(() => setDerivativeStatus({ state: "idle" }), 4000);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  }

  // 未生成サイト用に記事を生成 (現在の KW × 選択中サイト)
  async function generateArticleForSite() {
    if (!currentGroup || !selectedDestinationId) return;
    // 元ネタの idea (この KW グループの最初の記事から拝借)
    const baseArticle = currentGroup.articles[0];
    if (!baseArticle) return;
    setGenerateForSiteState({
      state: "loading",
      message: "このサイト用に生成中（約30〜60秒）...",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: baseArticle.idea,
          destinationId: selectedDestinationId,
          targetKeywordId: (baseArticle.idea as FeedIdea)?.targetKeywordId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `生成失敗 (${res.status})`);
      }
      const newArticle: Article = data.article;
      setArticles((prev) => {
        const next = [newArticle, ...prev];
        setCache(CACHE_KEY, next);
        return next;
      });
      setGenerateForSiteState({ state: "idle" });
    } catch (e) {
      clearTimeout(timeout);
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? "180秒経過してもサーバーから応答がありませんでした"
            : e.message
          : "生成失敗";
      setGenerateForSiteState({ state: "error", message: msg });
      setTimeout(() => setGenerateForSiteState({ state: "idle" }), 8000);
    }
  }

  // 選択 KW で未生成のサイト数
  const ungeneratedSiteCount = useMemo(() => {
    if (!currentGroup) return 0;
    const generated = new Set(
      currentGroup.articles
        .map((a) => a.destinationId)
        .filter((x): x is string => !!x),
    );
    return siteTabs.filter((d) => !generated.has(d.id)).length;
  }, [currentGroup, siteTabs]);

  // ---------- レンダリング ----------
  return (
    <>
      <PageHeader title="ライブラリ" />

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="ライブラリを読み込み中…" fill={false} />
        </div>
      ) : articles.length === 0 ? (
        <EmptyLibraryCta />
      ) : (
        <>
          {/* フィルター行: ジャンル + KW検索 */}
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)]">
                GENRE
              </label>
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="text-[13px] px-3 py-1.5 rounded-lg border border-[var(--border-card)] bg-white"
              >
                <option value="all">すべて ({articles.length})</option>
                {allGenres.map(([id, count]) => (
                  <option key={id} value={id}>
                    {THEME_LABEL[id] ?? id} ({count})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <label className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)]">
                KW
              </label>
              <input
                type="text"
                value={kwSearch}
                onChange={(e) => setKwSearch(e.target.value)}
                placeholder="キーワードで絞り込み..."
                className="flex-1 text-[13px] px-3 py-1.5 rounded-lg border border-[var(--border-card)] bg-white"
              />
            </div>
            <div className="text-[11px] font-mono text-[color:var(--fg-muted)]">
              {keywordGroups.length} KW / {articles.length} ARTICLES
            </div>
          </div>

          <div className="grid md:grid-cols-[280px_1fr] gap-5">
            {/* ---------- 左カラム: KW一覧 ---------- */}
            <aside className="space-y-1.5">
              {keywordGroups.length === 0 ? (
                <div className="text-[12px] text-[color:var(--fg-muted)] italic px-2 py-4">
                  該当KWなし
                </div>
              ) : (
                keywordGroups.map((g) => {
                  const isActive = selectedKwKey === g.key;
                  const generatedCount = new Set(
                    g.articles
                      .map((a) => a.destinationId)
                      .filter((x): x is string => !!x),
                  ).size;
                  return (
                    <button
                      key={g.key}
                      onClick={() => setSelectedKwKey(g.key)}
                      className={`w-full text-left p-3 rounded-xl transition-all border ${
                        isActive
                          ? "bg-white border-[color:var(--accent)] shadow-sm"
                          : "bg-white border-[var(--border-card)] hover:border-gray-400"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium leading-snug tracking-tight line-clamp-2">
                            {g.label}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {g.themeId && THEME_LABEL[g.themeId] && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[9.5px] text-[color:var(--fg-secondary)]">
                                {THEME_LABEL[g.themeId]}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] text-[9.5px]">
                              {generatedCount}/{siteTabs.length} サイト
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </aside>

            {/* ---------- 右カラム: サイトタブ + 記事プレビュー ---------- */}
            <section className="space-y-4">
              {!currentGroup ? (
                <div className="card p-12 text-center text-[color:var(--fg-muted)]">
                  ← 左から KW を選んでください
                </div>
              ) : (
                <>
                  {/* KWヘッダー */}
                  <div className="card p-4">
                    <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1">
                      KEYWORD
                    </div>
                    <h2 className="text-[18px] font-semibold tracking-tight">
                      {currentGroup.label}
                    </h2>
                    <div className="text-[12px] text-[color:var(--fg-secondary)] mt-1">
                      {currentGroup.articles.length} 記事 ・
                      未生成: {ungeneratedSiteCount} サイト
                    </div>
                  </div>

                  {/* サイトタブ */}
                  <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] overflow-x-auto">
                    {siteTabs.length === 0 ? (
                      <div className="text-[12px] text-[color:var(--fg-muted)] italic py-3 px-2">
                        投稿先未登録。{" "}
                        <Link href="/settings" className="underline">
                          設定 → 投稿先
                        </Link>{" "}
                        から追加
                      </div>
                    ) : (
                      siteTabs.map((d) => {
                        const isActive = selectedDestinationId === d.id;
                        const hasArticle = currentGroup.articles.some(
                          (a) => a.destinationId === d.id,
                        );
                        return (
                          <button
                            key={d.id}
                            onClick={() => setSelectedDestinationId(d.id)}
                            className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-[12px] whitespace-nowrap ${
                              isActive
                                ? "border-[color:var(--accent)] text-[color:var(--accent-dark)] font-medium"
                                : "border-transparent text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]"
                            }`}
                          >
                            <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                              {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
                            </span>
                            <span>{d.label}</span>
                            {hasArticle ? (
                              <span className="text-green-600 text-[10px]">✓</span>
                            ) : (
                              <span className="text-[color:var(--fg-muted)] text-[10px]">○</span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* タブ内コンテンツ: 該当 article or 未生成 */}
                  {currentArticle ? (
                    <article className="card p-7">
                      {currentArticle.imagePath && (
                        <img
                          src={currentArticle.imagePath}
                          alt={currentArticle.imageAltText ?? currentArticle.bestTitle}
                          className="w-full rounded-xl mb-5"
                        />
                      )}

                      <div className="inline-flex items-center gap-2 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
                        <span className="text-[11px] font-mono tracking-[0.25em] text-[color:var(--accent-dark)]">
                          ARTICLE
                        </span>
                        {currentArticle.postedAt && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                            ✓ 投稿済 (
                            {new Date(currentArticle.postedAt).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            )
                          </span>
                        )}
                      </div>
                      <h2 className="text-[24px] font-semibold tracking-tight leading-tight mb-2">
                        {currentArticle.bestTitle}
                      </h2>
                      <p className="text-[13px] text-[color:var(--fg-secondary)] mb-4">
                        {currentArticle.bestTitleReason}
                      </p>

                      {currentFeed && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-5 text-[11px]">
                          {currentFeed.themeId && THEME_LABEL[currentFeed.themeId] && (
                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[color:var(--fg-secondary)]">
                              テーマ: {THEME_LABEL[currentFeed.themeId]}
                            </span>
                          )}
                          {currentFeed.voice?.platform && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">
                              ネタ元: {currentFeed.voice.platform}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] font-mono">
                            🕒 {new Date(currentArticle.createdAt).toLocaleString("ja-JP", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          onClick={() => openPostModal(currentArticle)}
                          className="btn-primary"
                          title="note + 登録済み外部ブログにマルチポストする"
                        >
                          📤 マルチポスト
                        </button>
                        <button
                          onClick={() => copy(currentArticle.bestTitle, "title")}
                          className="btn-ghost"
                        >
                          {copied === "title" ? "✓ コピー完了" : "タイトルをコピー"}
                        </button>
                        <button
                          onClick={() => copy(currentArticle.bodyMarkdown, "body")}
                          className="btn-ghost"
                        >
                          {copied === "body" ? "✓ コピー完了" : "本文をコピー"}
                        </button>
                        {currentArticle.imagePath && (
                          <a href={currentArticle.imagePath} download className="btn-ghost">
                            画像DL
                          </a>
                        )}
                        <button
                          onClick={() => generateImage(currentArticle.id)}
                          disabled={imageStatus.state === "loading"}
                          className="btn-ghost"
                          title="Nano Banana (Gemini 2.5 Flash Image) で見出し画像を生成（約6円/枚）"
                        >
                          {imageStatus.state === "loading"
                            ? "🎨 生成中..."
                            : currentArticle.imagePath
                              ? "🔄 画像を再生成"
                              : "🎨 見出し画像を生成"}
                        </button>
                        <button
                          onClick={() => generateDerivative(currentArticle.id)}
                          disabled={derivativeStatus.state === "loading"}
                          className="btn-ghost"
                          title="この記事を起点に切り口違いの派生ネタ5件をフィードに追加"
                        >
                          {derivativeStatus.state === "loading"
                            ? "🔍 派生案を探索中..."
                            : "↳ このテーマで派生案"}
                        </button>
                      </div>
                      {imageStatus.message && (
                        <div
                          className={`mb-3 text-[12px] px-4 py-2 rounded-lg ${
                            imageStatus.state === "error"
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : imageStatus.state === "done"
                                ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
                                : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {imageStatus.message}
                        </div>
                      )}
                      {derivativeStatus.message && (
                        <div
                          className={`mb-5 text-[12px] px-4 py-2 rounded-lg ${
                            derivativeStatus.state === "error"
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : derivativeStatus.state === "done"
                                ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
                                : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {derivativeStatus.message}
                          {derivativeStatus.state === "done" && (
                            <Link href="/" className="ml-2 underline">
                              フィードを見る →
                            </Link>
                          )}
                        </div>
                      )}

                      <div className="hairline mb-5" />

                      <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3">
                        MARKDOWN
                      </div>
                      <pre className="p-5 rounded-xl bg-gray-50 border border-[var(--border-subtle)] text-[14px] leading-[1.85] whitespace-pre-wrap font-sans">
                        {currentArticle.bodyMarkdown}
                      </pre>
                    </article>
                  ) : (
                    /* 未生成スロット */
                    <div className="card p-10 text-center">
                      <div className="text-4xl mb-3 opacity-40">📝</div>
                      <p className="text-[14px] text-[color:var(--fg-secondary)] mb-1">
                        このサイト用にはまだ生成されていません
                      </p>
                      <p className="text-[12px] text-[color:var(--fg-muted)] mb-5">
                        同じネタでも destination ごとにプロンプトが違うため、サイト別に専用記事を生成できます
                      </p>
                      <button
                        onClick={generateArticleForSite}
                        disabled={generateForSiteState.state === "loading"}
                        className="btn-primary"
                      >
                        {generateForSiteState.state === "loading"
                          ? "🤖 生成中..."
                          : "✨ このサイト用に生成"}
                      </button>
                      {generateForSiteState.message && (
                        <div
                          className={`mt-4 text-[12px] px-4 py-2 rounded-lg inline-block ${
                            generateForSiteState.state === "error"
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {generateForSiteState.message}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}

      {postModalArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closePostModal}
        >
          <div
            className={`card w-full ${editingBody ? "max-w-3xl" : "max-w-md"} mx-4 p-6 bg-white max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
              MULTI-POST
            </div>
            <h3 className="text-[18px] font-semibold tracking-tight mb-1">
              {postModalArticle.bestTitle}
            </h3>
            <p className="text-[12px] text-[color:var(--fg-secondary)] mb-3">
              チェックを入れた宛先すべてに同じ記事を一括投稿します
            </p>

            {/* 本文編集セクション */}
            <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-gray-50/40">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="text-[11px] font-medium text-[color:var(--fg-secondary)]">
                  本文 ({(postModalArticle.bodyMarkdown ?? "").length.toLocaleString()} 文字)
                </div>
                {!editingBody ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBodyDraft(postModalArticle.bodyMarkdown ?? "");
                      setEditingBodyError(null);
                      setEditingBody(true);
                    }}
                    className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-card)] bg-white hover:bg-gray-50"
                    disabled={postStatus.state === "sending"}
                  >
                    ✏️ 本文編集
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBody(false);
                        setEditingBodyError(null);
                      }}
                      className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-card)] bg-white hover:bg-gray-50"
                      disabled={editingBodySaving}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={saveEditedBody}
                      className="text-[11px] px-2 py-1 rounded-md bg-black text-white hover:bg-gray-800 disabled:opacity-50"
                      disabled={editingBodySaving}
                    >
                      {editingBodySaving ? "保存中..." : "💾 保存"}
                    </button>
                  </div>
                )}
              </div>
              {editingBody && (
                <div className="px-3 pb-3">
                  <textarea
                    value={editingBodyDraft}
                    onChange={(e) => setEditingBodyDraft(e.target.value)}
                    className="w-full text-[13px] leading-[1.7] font-mono px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white"
                    rows={18}
                    spellCheck={false}
                    disabled={editingBodySaving}
                  />
                  {editingBodyError && (
                    <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                      {editingBodyError}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-[color:var(--fg-muted)]">
                    保存後は次回の投稿実行から反映されます。投稿済みの外部記事は影響を受けません。
                  </div>
                </div>
              )}
            </div>

            <div className="mb-4">
              <div className="text-[11px] font-medium text-[color:var(--fg-secondary)] mb-2">
                投稿先
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[13px] cursor-pointer p-2 rounded-lg border border-[var(--border-subtle)] hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedTargets.has("note")}
                    onChange={() => toggleTarget("note")}
                    disabled={postStatus.state === "sending"}
                  />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                    note (拡張)
                  </span>
                  <span className="text-[12px] text-[color:var(--fg-secondary)]">
                    Chrome拡張経由 (画像は手動セット)
                  </span>
                </label>
                {destinations.length === 0 ? (
                  <div className="text-[11px] text-[color:var(--fg-muted)] italic py-2 px-2">
                    外部ブログ未登録。{" "}
                    <Link href="/settings" className="underline">
                      設定 → 投稿先
                    </Link>{" "}
                    から追加してください
                  </div>
                ) : (
                  destinations.map((d) => {
                    const promptReady = isPromptReady(d);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 text-[13px] cursor-pointer p-2 rounded-lg border border-[var(--border-subtle)] hover:bg-gray-50 ${
                          !d.enabled ? "opacity-50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargets.has(d.id)}
                          onChange={() => toggleTarget(d.id)}
                          disabled={postStatus.state === "sending" || !d.enabled}
                        />
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]">
                          {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
                        </span>
                        <span className="text-[12px] text-[color:var(--fg-primary)] flex-1">
                          {d.label}
                        </span>
                        {promptReady ? (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700"
                            title="プロンプト設定済"
                          >
                            ✓ プロンプト有
                          </span>
                        ) : (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                            title="プロンプト未設定。設定→投稿先→プロンプトボタン から設定してください"
                          >
                            ⚠ プロンプト無
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <label className="block text-[12px] font-medium text-[color:var(--fg-secondary)] mb-1">
              タグ（カンマ区切り、最大5個・noteのみ反映）
            </label>
            <input
              type="text"
              value={postTagsInput}
              onChange={(e) => setPostTagsInput(e.target.value)}
              placeholder="例: AI, 時短, 主婦"
              className="w-full text-[13px] px-3 py-2 mb-4 rounded-lg border border-[var(--border-card)] bg-white"
              disabled={postStatus.state === "sending"}
            />

            <label className="flex items-center gap-2 text-[13px] mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={postPublish}
                onChange={(e) => setPostPublish(e.target.checked)}
                disabled={postStatus.state === "sending"}
              />
              公開まで進める（OFF = 下書きで止める）
            </label>

            {postStatus.message && (
              <div
                className={`mb-4 text-[12px] px-3 py-2 rounded-lg whitespace-pre-line ${
                  postStatus.state === "error"
                    ? "bg-red-50 text-red-700 border border-red-100"
                    : postStatus.state === "done"
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
                      : "bg-amber-50 text-amber-800"
                }`}
              >
                {postStatus.message}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={closePostModal}
                className="btn-ghost"
                disabled={postStatus.state === "sending"}
              >
                閉じる
              </button>
              <button
                onClick={submitPost}
                className="btn-primary"
                disabled={postStatus.state === "sending" || postStatus.state === "done"}
              >
                {postStatus.state === "sending" ? "送信中..." : "投稿実行"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
