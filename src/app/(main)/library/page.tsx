"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Article, FeedIdea, ThemeId } from "@/lib/types";
import { THEMES } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { getCache, setCache } from "@/lib/clientCache";
import { postToNote, type NotePostResult } from "@/lib/notePost";

const CACHE_KEY = "library:articles";

type GroupBy = "theme" | "source" | "keyword";

const THEME_LABEL: Record<string, string> = Object.fromEntries(
  THEMES.map((t) => [t.id, t.label]),
);

function feedIdeaOf(a: Article): FeedIdea | null {
  const idea = a.idea as Partial<FeedIdea>;
  return idea && (idea.themeId || idea.voice || idea.customLabel)
    ? (idea as FeedIdea)
    : null;
}

export default function LibraryPage() {
  const cached = getCache<Article[]>(CACHE_KEY);
  const [articles, setArticles] = useState<Article[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);
  const [active, setActive] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("theme");
  const [filter, setFilter] = useState<string>("all");
  const [derivativeStatus, setDerivativeStatus] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message?: string;
  }>({ state: "idle" });

  // note 投稿モーダル
  const [postModalArticle, setPostModalArticle] = useState<Article | null>(null);
  const [postTagsInput, setPostTagsInput] = useState("");
  const [postPublish, setPostPublish] = useState(true);
  const [postStatus, setPostStatus] = useState<{
    state: "idle" | "sending" | "done" | "error";
    message?: string;
  }>({ state: "idle" });

  function openPostModal(a: Article) {
    const fi = feedIdeaOf(a);
    const suggestedTags: string[] = [];
    if (fi?.keywords?.primary) suggestedTags.push(fi.keywords.primary);
    if (fi?.keywords?.secondary) suggestedTags.push(...fi.keywords.secondary);
    setPostTagsInput(suggestedTags.slice(0, 5).join(", "));
    setPostPublish(true);
    setPostStatus({ state: "idle" });
    setPostModalArticle(a);
  }

  function closePostModal() {
    if (postStatus.state === "sending") return;
    setPostModalArticle(null);
  }

  async function submitPost() {
    if (!postModalArticle) return;
    const tags = postTagsInput
      .split(/[,、]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);
    setPostStatus({ state: "sending", message: "拡張に送信中..." });
    const res: NotePostResult = await postToNote({
      title: postModalArticle.bestTitle,
      body: postModalArticle.bodyMarkdown,
      tags,
      publish: postPublish,
    });
    if (res.ok) {
      setPostStatus({
        state: "done",
        message: postPublish
          ? "公開ボタン押下まで送信。noteタブで結果を確認してください"
          : "下書きに入力完了。noteタブで確認してください",
      });
    } else {
      setPostStatus({ state: "error", message: res.error ?? "不明" });
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

  useEffect(() => {
    fetch("/api/articles")
      .then((r) => r.json())
      .then((d) => {
        const next = d.articles ?? [];
        setArticles(next);
        setCache(CACHE_KEY, next);
        if (next[0] && !active) setActive(next[0].id);
      })
      .finally(() => setInitialLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  }

  const themeCounts = useMemo(() => {
    const m = new Map<ThemeId, number>();
    for (const a of articles) {
      const t = feedIdeaOf(a)?.themeId;
      if (!t) continue;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [articles]);

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      const p = feedIdeaOf(a)?.voice?.platform?.trim();
      if (!p) continue;
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [articles]);

  const keywordCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of articles) {
      const k = feedIdeaOf(a)?.customLabel?.trim();
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [articles]);

  const filteredArticles = useMemo(() => {
    if (filter === "all") return articles;
    return articles.filter((a) => {
      const fi = feedIdeaOf(a);
      if (!fi) return false;
      if (filter.startsWith("theme:")) return fi.themeId === filter.slice(6);
      if (filter.startsWith("source:")) return (fi.voice?.platform ?? "") === filter.slice(7);
      if (filter.startsWith("keyword:")) return (fi.customLabel ?? "") === filter.slice(8);
      return true;
    });
  }, [articles, filter]);

  function selectGroup(g: GroupBy) {
    setGroupBy(g);
    setFilter("all");
  }

  const current = articles.find((a) => a.id === active);
  const currentFeed = current ? feedIdeaOf(current) : null;

  return (
    <>
      <PageHeader
        step="STEP 03 / LIBRARY"
        title="ライブラリ"
        description="生成された記事一覧。Markdownをコピーしてnoteに貼り付け → 予約投稿。"
      />

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="ライブラリを読み込み中…" fill={false} />
        </div>
      ) : articles.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4 opacity-30">∅</div>
          <p className="text-[color:var(--fg-secondary)] mb-5">まだ記事がありません。</p>
          <Link href="/" className="btn-primary inline-block">
            ① ネタ収集から始める
          </Link>
        </div>
      ) : (
        <>
          <div className="card p-4 mb-5 space-y-3">
            <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px">
              <GroupTab active={groupBy === "theme"} onClick={() => selectGroup("theme")}>
                テーマ別
              </GroupTab>
              <GroupTab active={groupBy === "source"} onClick={() => selectGroup("source")}>
                公式サイト別 <span className="opacity-60 ml-0.5">{sourceCounts.length}</span>
              </GroupTab>
              <GroupTab active={groupBy === "keyword"} onClick={() => selectGroup("keyword")}>
                キーワード別 <span className="opacity-60 ml-0.5">{keywordCounts.length}</span>
              </GroupTab>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
                すべて <span className="opacity-60 ml-1">{articles.length}</span>
              </FilterPill>
              <span className="mx-1 w-px h-5 bg-[var(--border-subtle)]" />
              {groupBy === "theme" &&
                THEMES.map((t) => {
                  const count = themeCounts.get(t.id) ?? 0;
                  if (count === 0) return null;
                  const v = `theme:${t.id}`;
                  return (
                    <FilterPill key={t.id} active={filter === v} onClick={() => setFilter(v)}>
                      {t.label} <span className="opacity-60 ml-1">{count}</span>
                    </FilterPill>
                  );
                })}
              {groupBy === "theme" && themeCounts.size === 0 && (
                <span className="text-[12px] text-[color:var(--fg-muted)] italic">
                  テーマ情報を持つ記事がまだありません
                </span>
              )}
              {groupBy === "source" &&
                (sourceCounts.length === 0 ? (
                  <span className="text-[12px] text-[color:var(--fg-muted)] italic">
                    ネタ元情報を持つ記事がまだありません
                  </span>
                ) : (
                  sourceCounts.map(([platform, count]) => {
                    const v = `source:${platform}`;
                    return (
                      <FilterPill key={platform} active={filter === v} onClick={() => setFilter(v)}>
                        {platform} <span className="opacity-60 ml-1">{count}</span>
                      </FilterPill>
                    );
                  })
                ))}
              {groupBy === "keyword" &&
                (keywordCounts.length === 0 ? (
                  <span className="text-[12px] text-[color:var(--fg-muted)] italic">
                    キーワード経由で生成された記事がまだありません
                  </span>
                ) : (
                  keywordCounts.map(([kw, count]) => {
                    const v = `keyword:${kw}`;
                    return (
                      <FilterPill key={kw} active={filter === v} onClick={() => setFilter(v)}>
                        {kw} <span className="opacity-60 ml-1">{count}</span>
                      </FilterPill>
                    );
                  })
                ))}
            </div>
          </div>

          <div className="grid md:grid-cols-[320px_1fr] gap-6">
            <aside className="space-y-2">
              <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3 px-2">
                {filteredArticles.length} / {articles.length} ARTICLES
              </div>
              {filteredArticles.length === 0 ? (
                <div className="text-[12px] text-[color:var(--fg-muted)] italic px-2 py-4">
                  該当記事なし
                </div>
              ) : (
                filteredArticles.map((a) => {
                  const isActive = active === a.id;
                  const fi = feedIdeaOf(a);
                  return (
                    <button
                      key={a.id}
                      onClick={() => setActive(a.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all border ${
                        isActive
                          ? "bg-white border-[color:var(--accent)] shadow-sm"
                          : "bg-white border-[var(--border-card)] hover:border-gray-400"
                      }`}
                    >
                      {a.imagePath ? (
                        <img
                          src={a.imagePath}
                          alt={a.imageAltText ?? a.bestTitle}
                          className="w-full aspect-video object-cover rounded-xl mb-2.5"
                        />
                      ) : (
                        <div className="w-full aspect-video rounded-lg mb-2.5 flex items-center justify-center text-[9px] tracking-widest text-[color:var(--fg-muted)] bg-gray-50 border border-[var(--border-subtle)]">
                          NO IMAGE
                        </div>
                      )}
                      <h3 className="font-medium text-[13px] line-clamp-2 leading-snug tracking-tight">
                        {a.bestTitle}
                      </h3>
                      {fi && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {fi.themeId && THEME_LABEL[fi.themeId] && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[9.5px] text-[color:var(--fg-secondary)]">
                              {THEME_LABEL[fi.themeId]}
                            </span>
                          )}
                          {fi.voice?.platform && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[9.5px]">
                              {fi.voice.platform}
                            </span>
                          )}
                          {fi.customLabel && (
                            <span className="px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] text-[9.5px] truncate max-w-[180px]">
                              🔥 {fi.customLabel}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-[10px] font-mono text-[color:var(--fg-muted)] mt-1.5">
                        {new Date(a.createdAt).toLocaleString("ja-JP", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </button>
                  );
                })
              )}
            </aside>

            {current && (
              <article className="card p-8">
                {current.imagePath && (
                  <img
                    src={current.imagePath}
                    alt={current.imageAltText ?? current.bestTitle}
                    className="w-full rounded-xl mb-6"
                  />
                )}

                <div className="inline-flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
                  <span className="text-[11px] font-mono tracking-[0.25em] text-[color:var(--accent-dark)]">
                    ARTICLE
                  </span>
                </div>
                <h2 className="text-[26px] font-semibold tracking-tight leading-tight mb-2">
                  {current.bestTitle}
                </h2>
                <p className="text-[13px] text-[color:var(--fg-secondary)] mb-4">
                  {current.bestTitleReason}
                </p>

                {currentFeed && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-6 text-[11px]">
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
                    {currentFeed.customLabel && (
                      <span className="px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]">
                        🔥 {currentFeed.customLabel}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => openPostModal(current)}
                    className="btn-primary"
                    title="拡張経由で note.com に投稿する"
                  >
                    📝 noteへ投稿
                  </button>
                  <button
                    onClick={() => copy(current.bestTitle, "title")}
                    className="btn-ghost"
                  >
                    {copied === "title" ? "✓ コピー完了" : "タイトルをコピー"}
                  </button>
                  <button
                    onClick={() => copy(current.bodyMarkdown, "body")}
                    className="btn-ghost"
                  >
                    {copied === "body" ? "✓ コピー完了" : "本文をコピー"}
                  </button>
                  {current.imagePath && (
                    <a href={current.imagePath} download className="btn-ghost">
                      画像DL
                    </a>
                  )}
                  <button
                    onClick={() => generateDerivative(current.id)}
                    disabled={derivativeStatus.state === "loading"}
                    className="btn-ghost"
                    title="この記事を起点に切り口違いの派生ネタ5件をフィードに追加"
                  >
                    {derivativeStatus.state === "loading"
                      ? "🔍 派生案を探索中..."
                      : "↳ このテーマで派生案"}
                  </button>
                </div>
                {derivativeStatus.message && (
                  <div
                    className={`mb-6 text-[12px] px-4 py-2 rounded-lg ${
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

                <div className="hairline mb-6" />

                <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3">
                  MARKDOWN
                </div>
                <pre className="p-6 rounded-xl bg-gray-50 border border-[var(--border-subtle)] text-[14px] leading-[1.85] whitespace-pre-wrap font-sans">
                  {current.bodyMarkdown}
                </pre>
              </article>
            )}
          </div>
        </>
      )}

      {postModalArticle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closePostModal}
        >
          <div
            className="card w-full max-w-md mx-4 p-6 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-2">
              POST TO NOTE
            </div>
            <h3 className="text-[18px] font-semibold tracking-tight mb-1">
              {postModalArticle.bestTitle}
            </h3>
            <p className="text-[12px] text-[color:var(--fg-secondary)] mb-4">
              拡張経由で note.com に投稿します
            </p>

            <label className="block text-[12px] font-medium text-[color:var(--fg-secondary)] mb-1">
              タグ（カンマ区切り、最大5個）
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
                className={`mb-4 text-[12px] px-3 py-2 rounded-lg ${
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

function GroupTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition ${
        active
          ? "border-[color:var(--accent)] text-[color:var(--fg-primary)]"
          : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition ${
        active
          ? "bg-[color:var(--black)] text-white"
          : "bg-white border border-[var(--border-card)] text-[color:var(--fg-secondary)] hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}
