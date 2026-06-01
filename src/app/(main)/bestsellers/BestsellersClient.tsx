"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProductScoreBreakdown from "@/components/ProductScoreBreakdown";
import { calculateProductScore } from "@/lib/productScoring";
import { generateMockProductMeta } from "@/lib/mockProductMeta";

type BestsellerItem = {
  id: string;
  category: string;
  rank: number;
  title: string;
  url: string;
  asin: string;
  image_url: string | null;
  source_used: "scrape" | "pa-api";
  fetched_at: string;
};

type CategoryGroup = {
  id: string;
  label: string;
  urlPath: string;
  items: BestsellerItem[];
};

type ListResponse = { categories: CategoryGroup[] };

export default function BestsellersClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshingCat, setRefreshingCat] = useState<string | "all" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  // PA-API 取得前は Mock メタで仮スコアを表示 (env で本番接続切替予定)
  const [useMockMeta, setUseMockMeta] = useState(true);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch("/api/bestsellers");
      const data: ListResponse = await res.json();
      setCategories(data.categories ?? []);
      if (!activeId && data.categories?.length > 0) {
        setActiveId(data.categories[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(scope: "all" | string) {
    setRefreshingCat(scope);
    setMessage(null);
    try {
      const res = await fetch("/api/bestsellers/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope === "all" ? {} : { category: scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      const ok = (data.results as { category: string; fetched: number; error?: string }[])
        .filter((r) => !r.error)
        .reduce((a, r) => a + r.fetched, 0);
      const errs = (data.results as { error?: string }[]).filter((r) => r.error).length;
      setMessage({
        kind: errs > 0 ? "error" : "success",
        text: `${ok} 件取得${errs > 0 ? `（失敗カテゴリ ${errs}）` : ""}`,
      });
      await fetchAll();
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "取得失敗",
      });
    } finally {
      setRefreshingCat(null);
    }
  }

  function scoutFromTitle(title: string) {
    router.push(`/products?q=${encodeURIComponent(title)}`);
  }

  const active = categories.find((c) => c.id === activeId);

  // PageHeader はタブ親 (ResearchClient) 側で「商品リサーチ」として表示済みなので
  // ここでは見出しなしでコンテンツのみ描画する (2026-06-01 商品リサーチ統合)
  return (
    <>
      <div className="max-w-4xl space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => refresh("all")}
            disabled={refreshingCat !== null}
            className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {refreshingCat === "all" ? "全カテゴリ取得中…" : "🔄 全カテゴリ取得"}
          </button>

          <div className="flex items-center gap-2">
            <select
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value || null)}
              disabled={refreshingCat !== null || categories.length === 0}
              className="input-base text-[12px] py-1.5"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.items.length > 0 ? ` (${c.items.length})` : ""}
                </option>
              ))}
            </select>
            {active && (
              <button
                type="button"
                onClick={() => refresh(active.id)}
                disabled={refreshingCat !== null}
                className="btn-ghost text-[12px] whitespace-nowrap"
              >
                {refreshingCat === active.id ? "取得中…" : "🔄 このカテゴリだけ取得"}
              </button>
            )}
          </div>

          {message && (
            <span
              className={`text-[11px] ${message.kind === "success" ? "text-[color:var(--accent-dark)]" : "text-red-600"}`}
            >
              {message.text}
            </span>
          )}

          <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[color:var(--fg-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={useMockMeta}
              onChange={(e) => setUseMockMeta(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            <span title="PA-API 未取得時に、ASIN シードの仮値で価格/レビュー/評価を出してスコアを試算します">
              📊 Mock データでスコア表示
            </span>
          </label>
        </div>

        <div className="text-[11px] text-[color:var(--fg-muted)] leading-snug p-3 rounded-lg bg-yellow-50 border border-yellow-200">
          ⚠ <strong>規約注意</strong>: Amazon は公式 API (PA-API) 以外の自動取得を推奨していません。
          本機能は MVP として簡易スクレイピングで動かしていますが、本番運用前に
          PA-API への切替を強く推奨します。レート対策のため 1カテゴリ間に 1秒のディレイを入れています。
        </div>

        {loading ? (
          <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
        ) : !active || active.items.length === 0 ? (
          <div className="p-6 rounded-lg border border-dashed border-[var(--border-card)] text-center">
            <p className="text-[13px] text-[color:var(--fg-secondary)]">
              {active?.label ?? "このカテゴリ"} にはまだベストセラーがありません
            </p>
            <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">
              上の「🔄 このカテゴリだけ取得」ボタンから取得してください
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {active.items.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
              >
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0 min-w-[2rem] text-center">
                  #{it.rank}
                </span>
                {it.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.image_url}
                    alt=""
                    className="w-14 h-14 rounded object-cover shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[color:var(--fg-primary)] line-clamp-2 leading-snug">
                    {it.title}
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--fg-muted)] mt-1">
                    ASIN: {it.asin} · {it.source_used}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {useMockMeta &&
                      (() => {
                        const meta = generateMockProductMeta(it.asin, it.category);
                        const breakdown = calculateProductScore({
                          price: meta.price,
                          feesRate: meta.feesRate,
                          reviewCount: meta.reviewCount,
                          rating: meta.rating,
                          // SEO 競合度は未スカウト (null) → 中央値50で計算
                          seoCompetition: null,
                          alreadyPosted: false,
                        });
                        return <ProductScoreBreakdown breakdown={breakdown} />;
                      })()}
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[color:var(--accent-dark)] hover:underline"
                    >
                      Amazon で見る ↗
                    </a>
                    <button
                      type="button"
                      onClick={() => scoutFromTitle(it.title)}
                      className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white"
                    >
                      🔍 この商品でスカウト
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
