"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Article, FeedIdea, ThemeId } from "@/lib/types";
import { THEMES } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { FilterBar, GroupTab } from "@/components/FilterBar";
import { getCache, setCache } from "@/lib/clientCache";
import { postToNote, type NotePostResult } from "@/lib/notePost";
import {
  PLATFORM_LABELS,
  getPlatformFaviconUrl,
  type Platform,
  type PostingDestinationRow,
} from "@/lib/posters/types";
import { useProject } from "@/components/ProjectContext";

const CACHE_KEY = "library:articles";
const SELECTED_KW_CACHE_KEY = "library:selectedKw";
const SELECTED_DEST_CACHE_KEY = "library:selectedDest";
const TAB_CACHE_KEY = "library:tab";

type LibraryTab = "adopted" | "articles";

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

// KW のグルーピングキー。同じネタ (idea) なら destination 違いでも同じ KW として束ねる。
// 表示する「キーワード」は a.idea.title (スカウト時に得た KW 本体)。
// customLabel ("🛒 商品名") はスカウト元の subject であって KW ではないので使わない。
function keywordKeyOf(a: Article): string {
  const fi = feedIdeaOf(a);
  return fi?.targetKeywordId ?? a.idea?.title ?? a.id;
}
function keywordLabelOf(a: Article): string {
  return a.idea?.title?.trim() || "(無題)";
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

  const [tab, setTabState] = useState<LibraryTab>(
    () => (getCache<LibraryTab>(TAB_CACHE_KEY) ?? "articles"),
  );
  const setTab = useCallback((t: LibraryTab) => {
    setTabState(t);
    setCache(TAB_CACHE_KEY, t);
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

  // 記事プレビューの見出し画像の表示/非表示トグル (画像が大きすぎる時用)
  const [showHeaderImage, setShowHeaderImage] = useState(true);

  // インライン編集 (詳細ビュー側のタイトル/本文を直接編集)
  type InlineEdit = {
    field: "title" | "body";
    draft: string;
    saving: boolean;
    error: string | null;
  };
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);

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

  // ライブラリ全体は「カラム内スクロール」設計のため、body のページ全体スクロールを抑止。
  // (これを忘れると右端にページ全体スクロールバーが残ってしまう)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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

  // 採用KW タブ用: scout 由来 (idea.customLabel が "🛒 *") の article 一覧
  const adoptedArticles = useMemo<Article[]>(() => {
    return articles.filter((a) => {
      const cl = (a.idea as FeedIdea)?.customLabel?.trim();
      return cl?.startsWith("🛒") ?? false;
    });
  }, [articles]);

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

  // 詳細ビュー側のインライン編集 (タイトル / 本文 を直接編集して PATCH)
  function startInlineEdit(field: "title" | "body") {
    if (!currentArticle) return;
    setInlineEdit({
      field,
      draft: field === "title" ? currentArticle.bestTitle : currentArticle.bodyMarkdown,
      saving: false,
      error: null,
    });
  }

  async function saveInlineEdit() {
    if (!currentArticle || !inlineEdit) return;
    const original =
      inlineEdit.field === "title"
        ? currentArticle.bestTitle
        : currentArticle.bodyMarkdown;
    if (inlineEdit.draft === original) {
      setInlineEdit(null);
      return;
    }
    setInlineEdit({ ...inlineEdit, saving: true, error: null });
    try {
      const body =
        inlineEdit.field === "title"
          ? { bestTitle: inlineEdit.draft }
          : { bodyMarkdown: inlineEdit.draft };
      const res = await fetch(`/api/articles/${currentArticle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
      const updated: Article = data.article;
      setArticles((prev) => {
        const next = prev.map((a) => (a.id === updated.id ? updated : a));
        setCache(CACHE_KEY, next);
        return next;
      });
      setInlineEdit(null);
    } catch (e) {
      setInlineEdit((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              error: e instanceof Error ? e.message : "保存に失敗しました",
            }
          : null,
      );
    }
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
    setTimeout(() => setCopied(null), 2000);
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
      <PageHeader title="ライブラリ">
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px">
            <GroupTab active={tab === "adopted"} onClick={() => setTab("adopted")}>
              採用KW
              {adoptedArticles.length > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({adoptedArticles.length})</span>
              )}
            </GroupTab>
            <GroupTab active={tab === "articles"} onClick={() => setTab("articles")}>
              生成記事
              {articles.length > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({articles.length})</span>
              )}
            </GroupTab>
          </div>
        </FilterBar>
      </PageHeader>

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="ライブラリを読み込み中…" fill={false} />
        </div>
      ) : articles.length === 0 ? (
        <EmptyLibraryCta />
      ) : tab === "articles" ? (
        // 「生成記事」タブ: KWスカウト履歴と同じ「ページ全体固定 + カラム内独立スクロール」
        <div className="md:sticky md:top-0 md:h-[calc(100vh-140px)] md:overflow-hidden md:-mt-8 -mt-6 -mx-4 md:-mx-8 px-2 md:px-4">
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 md:h-full">
            {/* ---------- 左カラム: フィルター + KW一覧 ---------- */}
            <aside className="flex flex-col md:h-full min-h-0">
              {/* フィルター: 右カラム上部ヘッダ (KWラベル h-[60px] + サイトタブ h-[40px] = 100px)
                  と境界線の Y 位置が揃うよう2段構成にする */}
              <div className="shrink-0 bg-white border-b border-[var(--border-subtle)]">
                <div className="h-[60px] flex items-center">
                  <select
                    value={genreFilter}
                    onChange={(e) => setGenreFilter(e.target.value)}
                    className="w-full text-[12px] px-3 py-1.5 rounded-lg border border-[var(--border-card)] bg-white"
                  >
                    <option value="all">ジャンル: すべて ({articles.length})</option>
                    {allGenres.map(([id, count]) => (
                      <option key={id} value={id}>
                        {THEME_LABEL[id] ?? id} ({count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="h-[40px] flex items-center">
                  <input
                    type="text"
                    value={kwSearch}
                    onChange={(e) => setKwSearch(e.target.value)}
                    placeholder="🔍 キーワードで絞り込み..."
                    className="w-full h-[28px] text-[12px] px-3 rounded-lg border border-[var(--border-card)] bg-white"
                  />
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto space-y-1.5 mt-2 pr-1 min-h-0">
              {keywordGroups.length === 0 ? (
                <li className="text-[12px] text-[color:var(--fg-muted)] italic px-2 py-4">
                  該当KWなし
                </li>
              ) : (
                keywordGroups.map((g) => {
                  const isActive = selectedKwKey === g.key;
                  const generatedCount = new Set(
                    g.articles
                      .map((a) => a.destinationId)
                      .filter((x): x is string => !!x),
                  ).size;
                  return (
                    <li key={g.key}>
                      <button
                        onClick={() => setSelectedKwKey(g.key)}
                        className={`w-full text-left p-3 rounded-xl transition-all border ${
                          isActive
                            ? "bg-white border-[color:var(--accent)] shadow-sm"
                            : "bg-white border-[var(--border-card)] hover:border-gray-400"
                        }`}
                      >
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
                      </button>
                    </li>
                  );
                })
              )}
              </ul>
            </aside>

            {/* ---------- 右カラム: サイトタブ + 記事プレビュー
                 外側コンテナの h-[calc(100vh-140px)] を埋める形で flex 配置、
                 内部の overflow-y-auto 領域だけが独立スクロール ---------- */}
            <section className="min-w-0 flex flex-col md:h-full min-h-0">
              {!currentGroup ? (
                <div className="m-auto card p-12 text-center text-[color:var(--fg-muted)]">
                  ← 左から KW を選んでください
                </div>
              ) : (
                <>
                  {/* 固定ヘッダ: サイトタブ + ボタン群 + メタバッジ。
                      合計高さを左カラムのフィルター (h-[60px]+h-[40px]=100px) に揃える */}
                  <div className="shrink-0 bg-white border-b border-[var(--border-subtle)]">
                    {/* サイトタブ h-[40px] (上段) */}
                    <div className="h-[40px] flex items-center flex-wrap -mb-px">
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
                              title={d.label}
                              className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition flex items-center gap-1.5 ${
                                isActive
                                  ? "border-[color:var(--accent)] text-[color:var(--fg-primary)]"
                                  : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg-secondary)]"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={getPlatformFaviconUrl(d.platform as Platform)}
                                alt=""
                                className="w-4 h-4 rounded-sm shrink-0"
                                loading="lazy"
                              />
                              <span>
                                {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
                              </span>
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
                    {/* ボタン群 + メタバッジ (下段、h-[60px])。
                        この shrink-0 親要素の border-b が
                        左カラム上ヘッダの border-b と同じ Y位置に揃う */}
                    {currentArticle && (
                      <div className="h-[60px] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openPostModal(currentArticle)}
                            className="btn-primary"
                            title="note + 登録済み外部ブログにマルチポストする"
                          >
                            📤 マルチポスト
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
                          {currentArticle.imagePath && (
                            <button
                              onClick={() => setShowHeaderImage((v) => !v)}
                              className="btn-ghost"
                              title="記事プレビューの見出し画像を一時的に隠す"
                            >
                              {showHeaderImage ? "🙈 画像を隠す" : "🖼 画像を表示"}
                            </button>
                          )}
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
                        {currentFeed && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
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
                      </div>
                    )}
                  </div>

                  {/* スクロール領域: 該当 article or 未生成 (画像から下) */}
                  <div className="flex-1 overflow-y-auto pr-1 mt-3 min-h-0">
                  {currentArticle ? (
                    <article className="card p-7">
                      {currentArticle.imagePath && showHeaderImage && (
                        <img
                          src={currentArticle.imagePath}
                          alt={currentArticle.imageAltText ?? currentArticle.bestTitle}
                          className="w-full rounded-xl mb-5"
                        />
                      )}

                      <div className="inline-flex items-center gap-2 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
                        <span className="text-[11px] font-mono tracking-[0.25em] text-[color:var(--accent-dark)]">
                          KEYWORD
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
                      {/* 主軸 = KW (= idea.title)。記事タイトルは補助情報として下に小さく表示 */}
                      <h2 className="text-[24px] font-semibold tracking-tight leading-tight mb-3">
                        {currentArticle.idea.title}
                      </h2>
                      <div className="mb-4 pl-3 border-l-2 border-[var(--border-subtle)]">
                        <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1">
                          ARTICLE TITLE
                        </div>
                        {inlineEdit?.field === "title" ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={inlineEdit.draft}
                              onChange={(e) =>
                                setInlineEdit({ ...inlineEdit, draft: e.target.value })
                              }
                              disabled={inlineEdit.saving}
                              autoFocus
                              className="w-full text-[15px] font-medium px-3 py-2 rounded-md border border-[var(--border-card)] bg-white"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setInlineEdit(null)}
                                disabled={inlineEdit.saving}
                                className="text-[11px] px-3 py-1 rounded-md border border-[var(--border-card)] bg-white hover:bg-gray-50"
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                onClick={saveInlineEdit}
                                disabled={inlineEdit.saving}
                                className="text-[11px] font-semibold px-3 py-1 rounded-md bg-black text-white hover:bg-gray-800 disabled:opacity-50 shadow-sm"
                              >
                                {inlineEdit.saving ? "保存中..." : "💾 保存"}
                              </button>
                            </div>
                            {inlineEdit.error && (
                              <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                                {inlineEdit.error}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="text-[15px] text-[color:var(--fg-primary)] font-medium leading-snug flex-1 min-w-0">
                              {currentArticle.bestTitle}
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <button
                                type="button"
                                onClick={() => startInlineEdit("title")}
                                className="text-[11px] font-semibold px-3 py-1 rounded-md border border-[var(--border-card)] bg-white text-[color:var(--fg-primary)] hover:bg-gray-50 shadow-sm"
                              >
                                ✏️ 編集
                              </button>
                              <button
                                type="button"
                                onClick={() => copy(currentArticle.bestTitle, "title")}
                                className={`text-[11px] font-semibold px-3 py-1 rounded-md transition shadow-sm ${
                                  copied === "title"
                                    ? "bg-emerald-600 text-white"
                                    : "bg-[color:var(--accent)] text-white hover:opacity-85"
                                }`}
                              >
                                {copied === "title" ? "✓ コピー完了!" : "📋 コピー"}
                              </button>
                            </div>
                          </div>
                        )}
                        {currentArticle.bestTitleReason && (
                          <p className="text-[12px] text-[color:var(--fg-secondary)] mt-1">
                            {currentArticle.bestTitleReason}
                          </p>
                        )}
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

                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)]">
                          MARKDOWN
                        </div>
                        {inlineEdit?.field !== "body" && (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => startInlineEdit("body")}
                              className="text-[11px] font-semibold px-3 py-1 rounded-md border border-[var(--border-card)] bg-white text-[color:var(--fg-primary)] hover:bg-gray-50 shadow-sm"
                            >
                              ✏️ 編集
                            </button>
                            <button
                              type="button"
                              onClick={() => copy(currentArticle.bodyMarkdown, "body")}
                              className={`text-[11px] font-semibold px-3 py-1 rounded-md transition shadow-sm ${
                                copied === "body"
                                  ? "bg-emerald-600 text-white"
                                  : "bg-[color:var(--accent)] text-white hover:opacity-85"
                              }`}
                            >
                              {copied === "body" ? "✓ コピー完了!" : "📋 コピー"}
                            </button>
                          </div>
                        )}
                      </div>
                      {inlineEdit?.field === "body" ? (
                        <div className="space-y-2">
                          <textarea
                            value={inlineEdit.draft}
                            onChange={(e) =>
                              setInlineEdit({ ...inlineEdit, draft: e.target.value })
                            }
                            disabled={inlineEdit.saving}
                            rows={22}
                            spellCheck={false}
                            className="w-full text-[14px] leading-[1.85] font-mono px-4 py-3 rounded-xl border border-[var(--border-card)] bg-white"
                          />
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] text-[color:var(--fg-muted)]">
                              {(inlineEdit.draft ?? "").length.toLocaleString()} 文字
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setInlineEdit(null)}
                                disabled={inlineEdit.saving}
                                className="text-[11px] px-3 py-1 rounded-md border border-[var(--border-card)] bg-white hover:bg-gray-50"
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                onClick={saveInlineEdit}
                                disabled={inlineEdit.saving}
                                className="text-[11px] font-semibold px-3 py-1 rounded-md bg-black text-white hover:bg-gray-800 disabled:opacity-50 shadow-sm"
                              >
                                {inlineEdit.saving ? "保存中..." : "💾 保存"}
                              </button>
                            </div>
                          </div>
                          {inlineEdit.error && (
                            <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                              {inlineEdit.error}
                            </div>
                          )}
                        </div>
                      ) : (
                        <pre className="p-5 rounded-xl bg-gray-50 border border-[var(--border-subtle)] text-[14px] leading-[1.85] whitespace-pre-wrap font-sans">
                          {currentArticle.bodyMarkdown}
                        </pre>
                      )}
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
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      ) : (
        // 「採用KW」タブ: scout 由来 (idea.customLabel が "🛒 *") の article 一覧
        <div className="md:sticky md:top-0 md:h-[calc(100vh-140px)] md:overflow-hidden md:-mt-8 -mt-6 -mx-4 md:-mx-8 px-2 md:px-4">
          <div className="flex flex-col md:h-full min-h-0">
            <div className="shrink-0 bg-white border-b border-[var(--border-subtle)] h-[60px] flex items-center justify-between">
              <div className="text-[12px] text-[color:var(--fg-secondary)]">
                記事生成済みの KW: <strong>{adoptedArticles.length}</strong> 件
              </div>
              <div className="text-[10px] text-[color:var(--fg-muted)] font-mono">
                KWスカウト → 記事生成 を実行したもの
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 mt-3 min-h-0">
              {adoptedArticles.length === 0 ? (
                <div className="p-8 rounded-lg border border-dashed border-[var(--border-card)] text-center">
                  <p className="text-[13px] text-[color:var(--fg-secondary)]">
                    採用KWはまだありません
                  </p>
                  <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
                    「KWスカウト → スカウト履歴」の候補カードから ✍記事生成 を押すと、ここに表示されます
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {adoptedArticles.map((a) => {
                    const fi = a.idea as FeedIdea;
                    const kw = a.idea.title;
                    const sourceSubject = fi?.customLabel?.replace(/^🛒\s*/, "")?.trim();
                    const dest = destinations.find((d) => d.id === a.destinationId);
                    const platform = dest?.platform as Platform | undefined;
                    return (
                      <li
                        key={a.id}
                        className="px-4 py-3 rounded-lg border border-[var(--border-card)] bg-white hover:border-gray-400 transition flex items-center gap-4"
                      >
                        {/* KW (主、可変幅) + 補助の subject */}
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

                        {/* platform バッジ (固定幅) */}
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

                        {/* 投稿状況 */}
                        {a.postedAt ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10.5px] w-[60px] text-center">
                            ✓ 投稿済
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10.5px] w-[60px] text-center">
                            ⏳ 未投稿
                          </span>
                        )}

                        {/* 日時 */}
                        <span className="shrink-0 text-[10.5px] font-mono text-[color:var(--fg-muted)] w-[90px] text-right">
                          {new Date(a.createdAt).toLocaleString("ja-JP", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>

                        {/* 記事を見るボタン */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedKwKey(keywordKeyOf(a));
                            if (a.destinationId) setSelectedDestinationId(a.destinationId);
                            setTab("articles");
                          }}
                          className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 transition"
                        >
                          📖 記事を見る
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
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
