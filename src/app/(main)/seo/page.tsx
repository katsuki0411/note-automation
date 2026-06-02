"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import type { SeoRanking, SeoTargetWithLatest } from "@/lib/seoRank";
import { PLATFORM_LABELS, type PostingDestinationRow } from "@/lib/posters/types";
import { getCache, setCache } from "@/lib/clientCache";

// 「自分の記事URL」候補: 各 destination の config.myUrlPrefix から拾う
type ArticleUrlOption = {
  id: string;
  label: string;
  urlPrefix: string;
};

const CACHE_KEY = "seo:targets";
const EXPANDED_CACHE_KEY = "seo:expandedId";
const HISTORY_CACHE_KEY = "seo:historyMap";
const RANK_SORT_CACHE_KEY = "seo:rankSort";

type RankSort = "none" | "asc" | "desc";

export default function SeoPage() {
  const cached = getCache<SeoTargetWithLatest[]>(CACHE_KEY);
  const cachedExpanded = getCache<string | null>(EXPANDED_CACHE_KEY);
  const cachedHistory = getCache<Record<string, SeoRanking[]>>(HISTORY_CACHE_KEY);
  const [targets, setTargets] = useState<SeoTargetWithLatest[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [expandedId, setExpandedIdState] = useState<string | null>(cachedExpanded ?? null);
  const [historyMap, setHistoryMapState] = useState<Record<string, SeoRanking[]>>(cachedHistory ?? {});

  const setExpandedId = useCallback((id: string | null) => {
    setExpandedIdState(id);
    setCache(EXPANDED_CACHE_KEY, id);
  }, []);

  const setHistoryMap = useCallback(
    (updater: Record<string, SeoRanking[]> | ((prev: Record<string, SeoRanking[]>) => Record<string, SeoRanking[]>)) => {
      setHistoryMapState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setCache(HISTORY_CACHE_KEY, next);
        return next;
      });
    },
    [],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newKw, setNewKw] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [articleUrls, setArticleUrls] = useState<ArticleUrlOption[]>([]);

  const cachedRankSort = getCache<RankSort>(RANK_SORT_CACHE_KEY);
  const [rankSort, setRankSortState] = useState<RankSort>(cachedRankSort ?? "none");
  const cycleRankSort = useCallback(() => {
    setRankSortState((prev) => {
      const next: RankSort = prev === "none" ? "asc" : prev === "asc" ? "desc" : "none";
      setCache(RANK_SORT_CACHE_KEY, next);
      return next;
    });
  }, []);

  // 順位ソート適用済みの表示用 targets。
  // 圏外/未取得 (rank === null) は順序に関わらず末尾に置く。
  const sortedTargets = useMemo(() => {
    if (rankSort === "none") return targets;
    const arr = [...targets];
    arr.sort((a, b) => {
      const ra = a.latest?.rank ?? null;
      const rb = b.latest?.rank ?? null;
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1; // null は末尾
      if (rb == null) return -1;
      return rankSort === "asc" ? ra - rb : rb - ra;
    });
    return arr;
  }, [targets, rankSort]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/seo/targets", { cache: "no-store" });
    const data = await res.json();
    const next = data.targets ?? [];
    setTargets(next);
    setCache(CACHE_KEY, next);
    setInitialLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 自分の記事URL候補は各 destination の config.myUrlPrefix から取得
  // (旧来は localStorage に保存していたが、投稿先設定に統合した)
  useEffect(() => {
    if (!showAdd) return;
    (async () => {
      try {
        const res = await fetch("/api/destinations", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { destinations?: PostingDestinationRow[] };
        const list = (data.destinations ?? [])
          .map((d) => {
            const cfg = d.config as { myUrlPrefix?: string };
            const url = cfg?.myUrlPrefix?.trim();
            if (!url) return null;
            const platformLabel = PLATFORM_LABELS[d.platform] ?? d.platform;
            return {
              id: d.id,
              label: `${d.label} (${platformLabel})`,
              urlPrefix: url,
            } as ArticleUrlOption;
          })
          .filter((x): x is ArticleUrlOption => x !== null);
        setArticleUrls(list);
      } catch {
        // ignore
      }
    })();
  }, [showAdd]);

  async function addTarget() {
    if (!newKw.trim() || !newUrl.trim()) {
      setMessage({ kind: "error", text: "キーワードと対象URLを入力してください" });
      return;
    }
    setBusy("add");
    try {
      const res = await fetch("/api/seo/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kw: newKw, targetUrlPrefix: newUrl, memo: newMemo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({ kind: "success", text: `「${data.target.kw}」を追加しました` });
      setNewKw("");
      setNewUrl("");
      setNewMemo("");
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(t: SeoTargetWithLatest) {
    await fetch(`/api/seo/targets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    await refresh();
  }

  async function removeTarget(t: SeoTargetWithLatest) {
    if (!confirm(`「${t.kw}」を削除しますか？\n履歴も全て消えます。`)) return;
    await fetch(`/api/seo/targets/${t.id}`, { method: "DELETE" });
    await refresh();
  }

  async function checkOne(t: SeoTargetWithLatest) {
    setBusy(`check:${t.id}`);
    try {
      const res = await fetch("/api/seo/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({ kind: "success", text: `「${t.kw}」を更新しました` });
      await refresh();
      if (expandedId === t.id) loadHistory(t.id);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function checkAll() {
    setBusy("checkAll");
    try {
      const res = await fetch("/api/seo/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({
        kind: "success",
        text: `${data.checked}件チェック完了${data.errors > 0 ? ` (エラー${data.errors}件)` : ""}`,
      });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function loadHistory(id: string) {
    const res = await fetch(`/api/seo/history/${id}`, { cache: "no-store" });
    const data = await res.json();
    setHistoryMap((m) => ({ ...m, [id]: data.history ?? [] }));
  }

  async function toggleExpand(t: SeoTargetWithLatest) {
    if (expandedId === t.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(t.id);
    if (!historyMap[t.id]) await loadHistory(t.id);
  }

  const enabledCount = targets.filter((t) => t.enabled).length;

  return (
    <>
      <PageHeader
        title="SEO順位チェック"
        right={
          <>
            <button
              onClick={checkAll}
              disabled={busy !== null || enabledCount === 0}
              className="btn-ghost"
            >
              {busy === "checkAll" ? "更新中..." : "全件いま更新"}
            </button>
            <button
              onClick={() => setShowAdd((s) => !s)}
              className={showAdd ? "btn-ghost" : "btn-primary"}
            >
              {showAdd ? "× 閉じる" : "+ 追加"}
            </button>
          </>
        }
      />

      {message && (
        <div className={`alert ${message.kind === "success" ? "alert-success" : "alert-error"}`}>
          {message.text}
        </div>
      )}

      {showAdd && (
        <section className="card p-5 mb-5 space-y-3">
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            NEW TARGET
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                追跡キーワード *
              </label>
              <input
                value={newKw}
                onChange={(e) => setNewKw(e.target.value)}
                placeholder="例: 保育園 欠席連絡 アプリ"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                対象URL（前方一致） *
              </label>
              {articleUrls.length > 0 ? (
                <>
                  <select
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)] bg-white"
                  >
                    <option value="">選択してください</option>
                    {articleUrls.map((u) => (
                      <option key={u.id} value={u.urlPrefix}>
                        {u.label}（{u.urlPrefix}）
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                    このURLで始まる検索結果を「自分のページ」と判定します。
                    <Link href="/settings" className="text-[color:var(--accent-dark)] underline ml-1">
                      設定→投稿先 で編集
                    </Link>
                  </p>
                </>
              ) : (
                <div className="px-3 py-2 rounded-lg border border-dashed border-[var(--border-card)] text-[12px] text-[color:var(--fg-muted)]">
                  記事URLが未登録です。
                  <Link href="/settings" className="text-[color:var(--accent-dark)] underline ml-1">
                    設定→投稿先 で各サイトの「自分の記事URL」を登録
                  </Link>
                  してください。
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                メモ（任意）
              </label>
              <input
                value={newMemo}
                onChange={(e) => setNewMemo(e.target.value)}
                placeholder="このキーワードを狙う理由など"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost">
              キャンセル
            </button>
            <button
              onClick={addTarget}
              disabled={busy === "add" || !newKw.trim() || !newUrl.trim()}
              className="btn-primary"
            >
              {busy === "add" ? "追加中..." : "追加する"}
            </button>
          </div>
        </section>
      )}

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="SEO追跡対象を読み込み中…" fill={false} />
        </div>
      ) : targets.length === 0 ? (
        <div className="card p-10 text-center text-[color:var(--fg-muted)] text-[13px]">
          まだ追跡対象がありません。右上の「+ 追加」から始めてください。
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden border border-[var(--border-card)] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-[color:var(--accent-soft)] via-white to-[color:var(--accent-soft)] border-b border-[color:var(--accent)]/20">
                <th className="text-[9.5px] font-mono tracking-[0.2em] uppercase text-[color:var(--fg-muted)] font-semibold px-3 py-3 text-left w-12">
                  状態
                </th>
                <th className="text-[9.5px] font-mono tracking-[0.2em] uppercase text-[color:var(--fg-muted)] font-semibold px-3 py-3 text-left">
                  キーワード / URL
                </th>
                <th className="px-3 py-3 text-center w-24">
                  <button
                    type="button"
                    onClick={cycleRankSort}
                    className={`inline-flex items-center gap-1 text-[9.5px] font-mono tracking-[0.2em] uppercase font-semibold rounded-md px-2 py-1 transition-colors ${
                      rankSort === "none"
                        ? "text-[color:var(--fg-muted)] hover:bg-white/60 hover:text-[color:var(--fg-secondary)]"
                        : "text-[color:var(--accent-dark)] bg-white shadow-sm shadow-black/5"
                    }`}
                    title={
                      rankSort === "none"
                        ? "クリックで昇順ソート"
                        : rankSort === "asc"
                          ? "現在: 昇順 (1位→10位)。クリックで降順へ"
                          : "現在: 降順 (10位→1位)。クリックで解除"
                    }
                  >
                    順位
                    <span className="text-[11px] leading-none">
                      {rankSort === "asc" ? "↑" : rankSort === "desc" ? "↓" : "⇅"}
                    </span>
                  </button>
                </th>
                <th className="text-[9.5px] font-mono tracking-[0.2em] uppercase text-[color:var(--fg-muted)] font-semibold px-3 py-3 text-center w-20">
                  変動
                </th>
                <th className="text-[9.5px] font-mono tracking-[0.2em] uppercase text-[color:var(--fg-muted)] font-semibold px-3 py-3 text-left w-32">
                  最終更新
                </th>
                <th className="text-[9.5px] font-mono tracking-[0.2em] uppercase text-[color:var(--fg-muted)] font-semibold px-3 py-3 text-right w-24">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTargets.map((t) => (
                <TargetRow
                  key={t.id}
                  target={t}
                  expanded={expandedId === t.id}
                  history={historyMap[t.id]}
                  busy={busy === `check:${t.id}`}
                  onToggle={() => toggleEnabled(t)}
                  onCheck={() => checkOne(t)}
                  onDelete={() => removeTarget(t)}
                  onExpand={() => toggleExpand(t)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function rankTierColor(rank: number | null): string {
  if (rank == null) return "text-[color:var(--fg-muted)]";
  if (rank <= 3) return "text-amber-500";        // ゴールド（top3）
  if (rank <= 10) return "text-[color:var(--accent-dark)]"; // ミント（top10）
  return "text-[color:var(--fg-secondary)]";     // それ以外
}

function TargetRow({
  target,
  expanded,
  history,
  busy,
  onToggle,
  onCheck,
  onDelete,
  onExpand,
}: {
  target: SeoTargetWithLatest;
  expanded: boolean;
  history: SeoRanking[] | undefined;
  busy: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onExpand: () => void;
}) {
  const cur = target.latest?.rank ?? null;
  const prev = target.previous?.rank ?? null;
  const diff = cur != null && prev != null ? prev - cur : null;

  return (
    <>
      <tr
        onClick={onExpand}
        className={`border-b border-[var(--border-subtle)] last:border-b-0 transition-colors cursor-pointer ${
          target.enabled ? "hover:bg-[color:var(--accent-soft)]/40" : "bg-gray-50 opacity-60 hover:bg-gray-100"
        } ${expanded ? "bg-[color:var(--accent-soft)]/30" : ""}`}
      >
        <td className="px-3 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggle}
            title={target.enabled ? "無効化" : "有効化"}
            className={`w-9 h-5 rounded-full transition shrink-0 relative ${
              target.enabled ? "bg-[color:var(--accent)]" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${
                target.enabled ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </td>

        <td className="px-3 py-3 align-middle min-w-0">
          <div className="text-[13.5px] font-semibold text-[color:var(--fg-primary)] truncate">
            {target.kw}
          </div>
          <div className="text-[11px] text-[color:var(--fg-muted)] font-mono truncate mt-0.5">
            {target.targetUrlPrefix}
          </div>
          {target.memo && (
            <div className="text-[11px] text-[color:var(--fg-muted)] italic truncate">
              {target.memo}
            </div>
          )}
        </td>

        <td className="px-3 py-3 align-middle text-center">
          {target.latest?.error ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-medium" title={target.latest.error}>
              エラー
            </span>
          ) : cur != null ? (
            <span className={`text-[22px] font-bold tabular-nums ${rankTierColor(cur)}`}>
              {cur}
              <span className="text-[10px] text-[color:var(--fg-muted)] ml-0.5 font-normal">位</span>
            </span>
          ) : target.latest ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-[color:var(--fg-muted)] text-[11px] font-medium">
              圏外
            </span>
          ) : (
            <span className="text-[11px] text-[color:var(--fg-muted)]">—</span>
          )}
        </td>

        <td className="px-3 py-3 align-middle text-center text-[12px] tabular-nums">
          {diff == null ? (
            <span className="text-[color:var(--fg-muted)]">—</span>
          ) : diff === 0 ? (
            <span className="text-[color:var(--fg-muted)]">±0</span>
          ) : diff > 0 ? (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] font-semibold">
              ↑{diff}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
              ↓{Math.abs(diff)}
            </span>
          )}
        </td>

        <td className="px-3 py-3 align-middle text-[11px] text-[color:var(--fg-muted)] font-mono whitespace-nowrap">
          {target.latest ? formatDate(target.latest.checkedAt) : "—"}
        </td>

        <td className="px-3 py-3 align-middle text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onCheck}
              disabled={busy}
              className="text-[11px] px-2.5 py-1 rounded-full bg-gray-50 hover:bg-[color:var(--accent-soft)] hover:text-[color:var(--accent-dark)] disabled:opacity-50 transition-colors font-medium"
              title="いま更新"
            >
              {busy ? "..." : "更新"}
            </button>
            <button
              onClick={onDelete}
              className="text-[color:var(--fg-muted)] hover:text-red-500 text-base leading-none px-1.5 transition-colors"
              title="削除"
            >
              ×
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-[var(--border-subtle)] last:border-b-0">
          <td colSpan={6} className="px-4 pb-4 pt-1 bg-gradient-to-b from-[color:var(--accent-soft)]/20 to-white">
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] py-2">
              HISTORY (直近60件)
            </div>
            {history == null ? (
              <div className="text-[11px] text-[color:var(--fg-muted)] py-2">読み込み中...</div>
            ) : history.length === 0 ? (
              <div className="text-[11px] text-[color:var(--fg-muted)] py-2">履歴なし</div>
            ) : (
              <>
              <HistoryChart history={history} />
              <div className="mt-3 max-h-48 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-[color:var(--fg-muted)] text-left">
                    <tr>
                      <th className="py-1 pr-3 font-normal">日時</th>
                      <th className="py-1 pr-3 font-normal">順位</th>
                      <th className="py-1 pr-3 font-normal">検出URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1 pr-3 font-mono">{formatDate(h.checkedAt)}</td>
                        <td className="py-1 pr-3 font-mono">
                          {h.error ? (
                            <span className="text-red-500">エラー</span>
                          ) : h.rank != null ? (
                            `${h.rank}位`
                          ) : (
                            <span className="text-[color:var(--fg-muted)]">圏外</span>
                          )}
                        </td>
                        <td className="py-1 pr-3 truncate max-w-[400px]">
                          {h.foundUrl ? (
                            <a
                              href={h.foundUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[color:var(--accent-dark)] hover:underline"
                            >
                              {h.foundUrl}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function HistoryChart({ history }: { history: SeoRanking[] }) {
  const data = [...history].reverse();
  if (data.length < 2) return null;
  const w = 600;
  const h = 80;
  const maxRank = 30;
  const points = data.map((r, i) => {
    const x = (i / (data.length - 1)) * w;
    const rank = r.rank ?? maxRank + 5; // 圏外は下に
    const y = (Math.min(rank, maxRank + 5) / (maxRank + 5)) * h;
    return { x, y, rank: r.rank };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20 bg-white rounded border border-[var(--border-subtle)]">
      <line x1="0" y1={h * (10 / 35)} x2={w} y2={h * (10 / 35)} stroke="#e5e7eb" strokeDasharray="2 2" />
      <line x1="0" y1={h * (20 / 35)} x2={w} y2={h * (20 / 35)} stroke="#e5e7eb" strokeDasharray="2 2" />
      <path d={path} fill="none" stroke="#41C9B4" strokeWidth="2" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="2.5"
          fill={p.rank == null ? "#cbd5e1" : "#41C9B4"}
        />
      ))}
    </svg>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}
