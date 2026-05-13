"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import type { SeoRanking, SeoTargetWithLatest } from "@/lib/seoRank";
import { readArticleUrls, type ArticleUrl } from "@/lib/clientSettings";
import { getCache, setCache } from "@/lib/clientCache";

const CACHE_KEY = "seo:targets";

export default function SeoPage() {
  const cached = getCache<SeoTargetWithLatest[]>(CACHE_KEY);
  const [targets, setTargets] = useState<SeoTargetWithLatest[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, SeoRanking[]>>({});

  const [showAdd, setShowAdd] = useState(false);
  const [newKw, setNewKw] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [articleUrls, setArticleUrls] = useState<ArticleUrl[]>([]);

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

  useEffect(() => {
    setArticleUrls(readArticleUrls());
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
        description={`Brave Searchで上位30位までスキャン・毎日10時自動更新。追跡中${enabledCount}/${targets.length}件`}
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
                      設定で編集
                    </Link>
                  </p>
                </>
              ) : (
                <div className="px-3 py-2 rounded-lg border border-dashed border-[var(--border-card)] text-[12px] text-[color:var(--fg-muted)]">
                  記事URLが未登録です。
                  <Link href="/settings" className="text-[color:var(--accent-dark)] underline ml-1">
                    設定ページで登録
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
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_120px_90px_140px_auto] gap-3 px-4 py-2.5 bg-gray-50 border-b border-[var(--border-subtle)] text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            <span></span>
            <span>KEYWORD / URL</span>
            <span className="text-center">RANK</span>
            <span className="text-center">DIFF</span>
            <span>UPDATED</span>
            <span></span>
          </div>
          {targets.map((t) => (
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
        </div>
      )}
    </>
  );
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
  const diff = cur != null && prev != null ? prev - cur : null; // 正=上昇, 負=下降

  return (
    <div
      className={`border-b border-[var(--border-subtle)] last:border-b-0 ${
        target.enabled ? "" : "bg-gray-50 opacity-60"
      }`}
    >
      <div className="grid grid-cols-[auto_1fr_120px_90px_140px_auto] gap-3 px-4 py-3 items-center">
        <button
          onClick={onToggle}
          title={target.enabled ? "無効化" : "有効化"}
          className={`w-9 h-5 rounded-full transition shrink-0 relative ${
            target.enabled ? "bg-[color:var(--accent)]" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${
              target.enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>

        <button onClick={onExpand} className="text-left min-w-0">
          <div className="text-[13.5px] font-medium truncate">{target.kw}</div>
          <div className="text-[11px] text-[color:var(--fg-muted)] font-mono truncate">
            {target.targetUrlPrefix}
          </div>
          {target.memo && (
            <div className="text-[11px] text-[color:var(--fg-muted)] italic truncate">
              {target.memo}
            </div>
          )}
        </button>

        <div className="text-center">
          {target.latest?.error ? (
            <span className="text-[11px] text-red-500" title={target.latest.error}>
              エラー
            </span>
          ) : cur != null ? (
            <span className="text-[20px] font-bold tabular-nums text-[color:var(--accent-dark)]">
              {cur}
              <span className="text-[10px] text-[color:var(--fg-muted)] ml-0.5">位</span>
            </span>
          ) : target.latest ? (
            <span className="text-[11px] text-[color:var(--fg-muted)]">圏外</span>
          ) : (
            <span className="text-[11px] text-[color:var(--fg-muted)]">未取得</span>
          )}
        </div>

        <div className="text-center text-[12px] tabular-nums">
          {diff == null ? (
            <span className="text-[color:var(--fg-muted)]">—</span>
          ) : diff === 0 ? (
            <span className="text-[color:var(--fg-muted)]">±0</span>
          ) : diff > 0 ? (
            <span className="text-[color:var(--accent-dark)] font-semibold">↑{diff}</span>
          ) : (
            <span className="text-red-500 font-semibold">↓{Math.abs(diff)}</span>
          )}
        </div>

        <div className="text-[11px] text-[color:var(--fg-muted)] font-mono">
          {target.latest ? formatDate(target.latest.checkedAt) : "—"}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onCheck}
            disabled={busy}
            className="text-[11px] px-2 py-1 rounded border border-[var(--border-card)] hover:border-[color:var(--accent)] disabled:opacity-50"
            title="いま更新"
          >
            {busy ? "..." : "更新"}
          </button>
          <button
            onClick={onDelete}
            className="text-[color:var(--fg-muted)] hover:text-red-500 text-base leading-none px-1.5"
            title="削除"
          >
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 bg-gray-50 border-t border-[var(--border-subtle)]">
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
        </div>
      )}
    </div>
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
