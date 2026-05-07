"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Article } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

export default function LibraryPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [derivativeStatus, setDerivativeStatus] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message?: string;
  }>({ state: "idle" });

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
        setArticles(d.articles ?? []);
        if (d.articles?.[0]) setActive(d.articles[0].id);
      });
  }, []);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  }

  const current = articles.find((a) => a.id === active);

  return (
    <>
      <PageHeader
        step="STEP 03 / LIBRARY"
        title="ライブラリ"
        description="生成された記事一覧。Markdownをコピーしてnoteに貼り付け → 予約投稿。"
      />

      {articles.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4 opacity-30">∅</div>
          <p className="text-[color:var(--fg-secondary)] mb-5">まだ記事がありません。</p>
          <Link href="/" className="btn-primary inline-block">
            ① ネタ収集から始める
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-[320px_1fr] gap-6">
          <aside className="space-y-2">
            <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-3 px-2">
              {articles.length} ARTICLES
            </div>
            {articles.map((a) => {
              const isActive = active === a.id;
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
                      alt=""
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
            })}
          </aside>

          {current && (
            <article className="card p-8">
              {current.imagePath && (
                <img
                  src={current.imagePath}
                  alt={current.bestTitle}
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
              <p className="text-[13px] text-[color:var(--fg-secondary)] mb-6">
                {current.bestTitleReason}
              </p>

              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => copy(current.bestTitle, "title")}
                  className="btn-primary"
                >
                  {copied === "title" ? "✓ コピー完了" : "タイトルをコピー"}
                </button>
                <button
                  onClick={() => copy(current.bodyMarkdown, "body")}
                  className="btn-primary"
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
      )}
    </>
  );
}
