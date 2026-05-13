"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { getCache, setCache } from "@/lib/clientCache";
import {
  PLATFORM_CATEGORY_META,
  type Platform,
  type PlatformCategory,
} from "@/lib/types";

const CACHE_KEY = "platforms:list";

const CATEGORIES: PlatformCategory[] = ["qa", "forum", "sns", "blog", "news", "other"];

export default function PlatformsPage() {
  const cached = getCache<Platform[]>(CACHE_KEY);
  const [platforms, setPlatforms] = useState<Platform[]>(cached ?? []);
  const [initialLoaded, setInitialLoaded] = useState(cached !== undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // 追加フォーム
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<PlatformCategory>("forum");
  const [newMemo, setNewMemo] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/platforms", { cache: "no-store" });
    const data = await res.json();
    const next = data.platforms ?? [];
    setPlatforms(next);
    setCache(CACHE_KEY, next);
    setInitialLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const g: Record<PlatformCategory, Platform[]> = {
      qa: [], forum: [], sns: [], blog: [], news: [], other: [],
    };
    for (const p of platforms) {
      g[p.category].push(p);
    }
    return g;
  }, [platforms]);

  async function addPlatform() {
    if (!newDomain.trim() || !newLabel.trim()) {
      setMessage({ kind: "error", text: "ドメインと表示名を入力してください" });
      return;
    }
    setBusy("add");
    try {
      const res = await fetch("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: newDomain,
          label: newLabel,
          category: newCategory,
          memo: newMemo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({ kind: "success", text: `「${data.platform.label}」を追加しました` });
      setNewDomain("");
      setNewLabel("");
      setNewMemo("");
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(p: Platform) {
    await fetch(`/api/platforms/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    await refresh();
  }

  async function updateLabel(p: Platform, label: string) {
    if (!label.trim() || label === p.label) return;
    await fetch(`/api/platforms/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    await refresh();
  }

  async function updateCategory(p: Platform, category: PlatformCategory) {
    await fetch(`/api/platforms/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    await refresh();
  }

  async function deletePlatform(p: Platform) {
    if (p.isDefault) {
      if (!confirm(`「${p.label}」はデフォルト項目です。\n削除する代わりに「無効化」されます。続行しますか？`)) return;
    } else {
      if (!confirm(`「${p.label}」を削除しますか？`)) return;
    }
    await fetch(`/api/platforms/${p.id}`, { method: "DELETE" });
    await refresh();
  }

  const enabledCount = platforms.filter((p) => p.enabled).length;

  return (
    <>
      <PageHeader
        step="STEP 04 / SOURCES"
        title="情報源プラットフォーム"
        description={`ネタ収集で検索する主婦悩み相談サイト。有効${enabledCount}/${platforms.length}件`}
        right={
          <button
            onClick={() => setShowAdd((s) => !s)}
            className={showAdd ? "btn-ghost" : "btn-primary"}
          >
            {showAdd ? "× 閉じる" : "+ サイト追加"}
          </button>
        }
      />

      {message && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg text-[13px] ${
            message.kind === "success"
              ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
              : "bg-red-50 text-red-700 border border-red-100"
          }`}
        >
          {message.text}
        </div>
      )}

      {showAdd && (
        <section className="card p-5 mb-5 space-y-3">
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            NEW SOURCE
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                ドメイン *
              </label>
              <input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="例: ameblo.jp"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                表示名 *
              </label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="例: アメーバブログ"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                カテゴリ
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as PlatformCategory)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {PLATFORM_CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--fg-muted)] mb-1">
                メモ（任意）
              </label>
              <input
                value={newMemo}
                onChange={(e) => setNewMemo(e.target.value)}
                placeholder="このサイトを使う理由など"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowAdd(false)}
              className="btn-ghost"
            >
              キャンセル
            </button>
            <button
              onClick={addPlatform}
              disabled={busy === "add" || !newDomain.trim() || !newLabel.trim()}
              className="btn-primary"
            >
              {busy === "add" ? "追加中..." : "追加する"}
            </button>
          </div>
        </section>
      )}

      {!initialLoaded ? (
        <div className="card p-10">
          <Loading size="lg" message="情報源を読み込み中…" fill={false} />
        </div>
      ) : (
      <div className="space-y-5">
        {CATEGORIES.map((cat) => {
          const list = grouped[cat];
          if (list.length === 0) return null;
          const meta = PLATFORM_CATEGORY_META[cat];
          return (
            <section key={cat} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: meta.color, border: "1px solid rgba(0,0,0,0.1)" }}
                  />
                  <h2 className="font-semibold text-[14px]">{meta.label}</h2>
                  <span className="text-[11px] font-mono text-[color:var(--fg-muted)]">
                    {list.filter((p) => p.enabled).length}/{list.length}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                {list.map((p) => (
                  <PlatformRow
                    key={p.id}
                    platform={p}
                    onToggle={() => toggleEnabled(p)}
                    onLabelChange={(l) => updateLabel(p, l)}
                    onCategoryChange={(c) => updateCategory(p, c)}
                    onDelete={() => deletePlatform(p)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      )}
    </>
  );
}

function PlatformRow({
  platform,
  onToggle,
  onLabelChange,
  onCategoryChange,
  onDelete,
}: {
  platform: Platform;
  onToggle: () => void;
  onLabelChange: (label: string) => void;
  onCategoryChange: (cat: PlatformCategory) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(platform.label);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition ${
        platform.enabled
          ? "bg-white border-[var(--border-card)]"
          : "bg-gray-50 border-[var(--border-subtle)] opacity-60"
      }`}
    >
      <button
        onClick={onToggle}
        title={platform.enabled ? "無効化" : "有効化"}
        className={`w-9 h-5 rounded-full transition shrink-0 relative ${
          platform.enabled ? "bg-[color:var(--accent)]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${
            platform.enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => {
              onLabelChange(labelDraft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onLabelChange(labelDraft);
                setEditing(false);
              } else if (e.key === "Escape") {
                setLabelDraft(platform.label);
                setEditing(false);
              }
            }}
            className="text-[13.5px] font-medium px-1 py-0.5 rounded border border-[var(--accent)] bg-white"
          />
        ) : (
          <button
            onClick={() => {
              setLabelDraft(platform.label);
              setEditing(true);
            }}
            className="text-[13.5px] font-medium hover:text-[color:var(--accent-dark)] text-left"
            title="クリックで編集"
          >
            {platform.label}
          </button>
        )}
        <div className="text-[11px] text-[color:var(--fg-muted)] flex gap-2 flex-wrap">
          <a
            href={`https://${platform.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono hover:underline"
          >
            {platform.domain}
          </a>
          {platform.isDefault && (
            <span className="px-1.5 py-0 rounded bg-blue-50 text-blue-700 text-[10px]">
              標準
            </span>
          )}
          {platform.memo && <span className="italic truncate">・{platform.memo}</span>}
        </div>
      </div>

      <select
        value={platform.category}
        onChange={(e) => onCategoryChange(e.target.value as PlatformCategory)}
        className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] bg-white shrink-0"
        title="カテゴリ"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {PLATFORM_CATEGORY_META[c].label}
          </option>
        ))}
      </select>

      <button
        onClick={onDelete}
        className="text-[color:var(--fg-muted)] hover:text-red-500 text-base leading-none px-1.5 shrink-0"
        title={platform.isDefault ? "標準項目は無効化のみ" : "削除"}
      >
        ×
      </button>
    </div>
  );
}
