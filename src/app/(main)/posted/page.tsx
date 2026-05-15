"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Article } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { getCache, setCache } from "@/lib/clientCache";

const CACHE_KEY = "library:articles";

function formatDate(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PostedPage() {
  const cached = getCache<Article[]>(CACHE_KEY);
  const [articles, setArticles] = useState<Article[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);

  useEffect(() => {
    fetch("/api/articles")
      .then((r) => r.json())
      .then((d) => {
        const next: Article[] = d.articles ?? [];
        setArticles(next);
        setCache(CACHE_KEY, next);
      })
      .finally(() => setInitialLoaded(true));
  }, []);

  const posted = useMemo(() => {
    return articles
      .filter((a) => !!a.postedAt)
      .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  }, [articles]);

  return (
    <>
      <PageHeader
        title="投稿レコード"
        description="note へ投稿（公開ボタン押下）まで完了した記事の履歴。"
      />

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="読み込み中…" fill={false} />
        </div>
      ) : posted.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4 opacity-30">∅</div>
          <p className="text-[color:var(--fg-secondary)] mb-5">
            まだ投稿レコードがありません。ライブラリから「noteへ投稿」してください。
          </p>
          <Link href="/library" className="btn-primary inline-block">
            ライブラリへ
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
            <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)]">
              {posted.length} POSTED
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[color:var(--accent-soft)]/50 text-[11px] font-mono tracking-widest text-[color:var(--accent-dark)]">
                  <th className="text-left px-5 py-3 font-medium w-[140px]">投稿日時</th>
                  <th className="text-left px-5 py-3 font-medium">タイトル</th>
                  <th className="text-left px-5 py-3 font-medium w-[80px]">画像</th>
                  <th className="text-left px-5 py-3 font-medium w-[120px]">アクション</th>
                </tr>
              </thead>
              <tbody>
                {posted.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[var(--border-subtle)] hover:bg-[color:var(--accent-soft)]/30 transition-colors"
                  >
                    <td className="px-5 py-3 text-[12px] font-mono text-[color:var(--fg-secondary)] whitespace-nowrap">
                      {formatDate(a.postedAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-[color:var(--fg-primary)] leading-snug">
                        {a.bestTitle}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {a.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.imagePath}
                          alt=""
                          className="w-14 h-8 object-cover rounded"
                        />
                      ) : (
                        <span className="text-[11px] text-[color:var(--fg-muted)]">なし</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/library?id=${a.id}`}
                        className="text-[12px] text-[color:var(--accent-dark)] hover:underline"
                      >
                        詳細を見る →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
