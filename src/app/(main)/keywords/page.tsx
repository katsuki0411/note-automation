"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useGeneration } from "@/components/GenerationProvider";
import {
  SUBCATEGORIES,
  THEMES,
  type Keyword,
  type KeywordCompetition,
  type KeywordIntent,
  type KeywordStatus,
  type KeywordVolume,
  type ThemeId,
} from "@/lib/types";

type HotKeyword = {
  kw: string;
  volumeHint: "high" | "medium" | "low" | "niche";
  competitionHint: "high" | "medium" | "low";
  riseStatus: "rising" | "stable" | "declining";
  intent: "info" | "how-to" | "comparison" | "trouble";
  priority: number;
  whyHot: string;
  themeId: ThemeId;
};

const INTENT_LABEL: Record<KeywordIntent, string> = {
  info: "情報",
  "how-to": "やり方",
  comparison: "比較",
  trouble: "悩み",
};

const STATUS_PALETTE: Record<
  KeywordStatus,
  { bg: string; fg: string; label: string }
> = {
  untargeted: { bg: "#f3f4f6", fg: "#4b5563", label: "未着手" },
  targeted: { bg: "#fef3c7", fg: "#92400e", label: "狙い中" },
  covered: { bg: "#dcfce7", fg: "#15803d", label: "Covered" },
};

type Tab = "owned" | "hot";

export default function KeywordsPage() {
  const { enqueue } = useGeneration();
  const [activeTab, setActiveTab] = useState<Tab>("hot");
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [activeTheme, setActiveTheme] = useState<ThemeId>("renraku");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [suggestForKey, setSuggestForKey] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ kw: string; intent?: string; vol?: string; comp?: string; priority?: number; memo?: string }>
  >([]);
  const [hotKeywords, setHotKeywords] = useState<HotKeyword[]>([]);
  const [hotDiscoveredAt, setHotDiscoveredAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/keywords", { cache: "no-store" });
    const data = await res.json();
    setKeywords(data.keywords ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const themeKws = useMemo(() => {
    return keywords.filter((k) => k.themeId === activeTheme);
  }, [keywords, activeTheme]);

  async function backfill() {
    setBusy("backfill");
    setMessage(null);
    try {
      const res = await fetch("/api/keywords/backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({
        kind: "success",
        text: `${data.processedArticles}記事から処理 → 新規${data.added}件追加 / ${data.attached}件にarticle追加`,
      });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy("scan");
    setMessage(null);
    try {
      const res = await fetch("/api/keywords/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({
        kind: "success",
        text: `${data.processedKeywords}KW × ${data.processedArticles}記事 スキャン完了 → ${data.attached}件カバー追加 / 未着手${data.stillUntargeted}件`,
      });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function suggest(themeId: ThemeId, subcategoryId: string) {
    const key = `${themeId}:${subcategoryId}`;
    setSuggestForKey(key);
    setBusy(`suggest:${key}`);
    setSuggestions([]);
    setMessage(null);
    try {
      const res = await fetch("/api/keywords/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId, subcategoryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuggestions(data.suggestions ?? []);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
      setSuggestForKey(null);
    } finally {
      setBusy(null);
    }
  }

  async function adoptSuggestion(
    themeId: ThemeId,
    subcategoryId: string,
    s: { kw: string; intent?: string; vol?: string; comp?: string; priority?: number; memo?: string },
  ) {
    setBusy(`adopt:${s.kw}`);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId,
          subcategoryId,
          kw: s.kw,
          intent: (s.intent as KeywordIntent) ?? "trouble",
          vol: (s.vol as KeywordVolume) ?? "medium",
          comp: (s.comp as KeywordCompetition) ?? "medium",
          priority: typeof s.priority === "number" ? s.priority : 60,
          memo: s.memo,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setSuggestions((prev) => prev.filter((x) => x.kw !== s.kw));
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteKw(id: string) {
    if (!confirm("削除しますか？")) return;
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function addManualKw(themeId: ThemeId, subcategoryId: string) {
    const kw = prompt("キーワードを入力");
    if (!kw?.trim()) return;
    await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        themeId,
        subcategoryId,
        kw: kw.trim(),
        intent: "trouble",
        priority: 60,
      }),
    });
    await refresh();
  }

  async function updateStatus(id: string, status: KeywordStatus) {
    await fetch(`/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

  async function updatePriority(id: string, priority: number) {
    await fetch(`/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    });
    await refresh();
  }

  async function discoverHot() {
    setBusy("discover");
    setMessage(null);
    try {
      const res = await fetch("/api/keywords/discover-hot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: activeTheme }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHotKeywords(data.hot ?? []);
      setHotDiscoveredAt(new Date().toISOString());
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "発見失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function generateFromKw(kw: string, themeId: ThemeId, subcategoryId: string = "other") {
    setBusy(`gen:${kw}`);
    setMessage(null);
    try {
      const res = await fetch("/api/keywords/seed-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kw, themeId, subcategoryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.feedIdea) {
        enqueue([data.feedIdea]);
        const voiceMsg =
          data.voiceCandidates > 0
            ? `${data.voiceCandidates}件の実投稿候補から最適なvoiceを使用`
            : "⚠️ 実投稿が見つからずAI生成voiceで作成";
        setMessage({
          kind: "success",
          text: `「${kw}」を記事化キューに追加（${voiceMsg}）。右下の進捗バーをご確認ください`,
        });
      } else {
        throw new Error("feedIdea生成に失敗");
      }
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  async function adoptHotToDictionary(h: HotKeyword) {
    setBusy(`adopt-hot:${h.kw}`);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: h.themeId,
          subcategoryId: "other",
          kw: h.kw,
          intent: h.intent,
          vol: h.volumeHint,
          comp: h.competitionHint,
          priority: h.priority,
          memo: `🔥 ホット: ${h.whyHot}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage({ kind: "success", text: `「${h.kw}」を辞書に追加しました` });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "失敗" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        step="STEP 03 / KEYWORDS"
        title="キーワード戦略"
        description="🔥 ホットKWを発見 → そのKWで記事を作る／📚 蓄積したKWの進捗管理"
        right={
          activeTab === "owned" ? (
            <>
              <button onClick={backfill} disabled={!!busy} className="btn-ghost">
                {busy === "backfill" ? "投入中..." : "既存記事から投入"}
              </button>
              <button onClick={scan} disabled={!!busy} className="btn-ghost">
                {busy === "scan" ? "スキャン中..." : "カバー再スキャン"}
              </button>
            </>
          ) : null
        }
      />

      {/* タブ切替 */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border-subtle)]">
        <button
          onClick={() => setActiveTab("hot")}
          className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 transition ${
            activeTab === "hot"
              ? "border-[color:var(--accent)] text-[color:var(--accent-dark)]"
              : "border-transparent text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]"
          }`}
        >
          🔥 ホットKW発見
        </button>
        <button
          onClick={() => setActiveTab("owned")}
          className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 transition ${
            activeTab === "owned"
              ? "border-[color:var(--accent)] text-[color:var(--accent-dark)]"
              : "border-transparent text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]"
          }`}
        >
          📚 保有KW <span className="text-[10px] font-mono opacity-60 ml-1">{keywords.length}</span>
        </button>
      </div>

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

      {/* テーマタブ */}
      <div className="card p-2 mb-5 flex gap-1 overflow-x-auto">
        {THEMES.filter((t) => t.id !== "custom").map((t) => {
          const count = keywords.filter((k) => k.themeId === t.id).length;
          const covered = keywords.filter(
            (k) => k.themeId === t.id && k.status === "covered",
          ).length;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTheme(t.id)}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium transition shrink-0 ${
                activeTheme === t.id
                  ? "bg-[color:var(--black)] text-white"
                  : "text-[color:var(--fg-secondary)] hover:bg-gray-100"
              }`}
            >
              {t.label}
              {activeTab === "owned" && (
                <span className="ml-2 text-[11px] font-mono opacity-60">
                  {covered}/{count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ホットKW発見タブ */}
      {activeTab === "hot" && (
        <section className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h2 className="font-bold text-[15px] mb-0.5">
                {THEMES.find((t) => t.id === activeTheme)?.label}で今熱いKW
              </h2>
              <p className="text-[11px] text-[color:var(--fg-secondary)]">
                Geminiが Web検索しながら発掘。発見後は ⊕ 辞書追加 or 📝 記事化を選択
                {hotDiscoveredAt && (
                  <span className="ml-2 text-[color:var(--fg-muted)]">
                    · {new Date(hotDiscoveredAt).toLocaleString("ja-JP")} 発見
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={discoverHot}
              disabled={busy === "discover"}
              className="btn-primary"
            >
              {busy === "discover" ? "🔍 発見中..." : "🔥 ホットKWを発見"}
            </button>
          </div>

          {hotKeywords.length === 0 && busy !== "discover" && (
            <p className="text-[12px] text-[color:var(--fg-muted)] py-8 text-center">
              「🔥 ホットKWを発見」ボタンを押すと、このテーマで今主婦の間で話題のキーワードを Gemini が Web検索しながら10件発掘します。
            </p>
          )}

          {hotKeywords.length > 0 && (
            <div className="space-y-1.5">
              {hotKeywords.map((h) => (
                <HotKwRow
                  key={h.kw}
                  hot={h}
                  busy={busy}
                  alreadyInDict={keywords.some(
                    (k) => k.kw.toLowerCase().trim() === h.kw.toLowerCase().trim(),
                  )}
                  onAdopt={() => adoptHotToDictionary(h)}
                  onGenerate={() => generateFromKw(h.kw, h.themeId)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 保有KWタブ・サブカテゴリ別表示 */}
      {activeTab === "owned" && (
      <div className="space-y-6">
        {SUBCATEGORIES[activeTheme].map((sub) => {
          const subKws = themeKws.filter((k) => k.subcategoryId === sub.id);
          const sorted = [...subKws].sort((a, b) => b.priority - a.priority);
          const sugKey = `${activeTheme}:${sub.id}`;
          const isSuggesting = suggestForKey === sugKey;
          return (
            <section key={sub.id} className="card p-5">
              <div className="flex items-center justify-between mb-3 gap-3">
                <div>
                  <h2 className="font-semibold text-[15px]">
                    {sub.label}
                    <span className="ml-2 text-[11px] font-mono text-[color:var(--fg-muted)]">
                      {sorted.length}件
                    </span>
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => addManualKw(activeTheme, sub.id)}
                    className="btn-ghost text-[11px]"
                  >
                    + 追加
                  </button>
                  <button
                    onClick={() => suggest(activeTheme, sub.id)}
                    disabled={busy === `suggest:${sugKey}`}
                    className="btn-ghost text-[11px]"
                  >
                    {busy === `suggest:${sugKey}` ? "🔍 提案中..." : "AIで候補提案"}
                  </button>
                </div>
              </div>

              {/* KWテーブル */}
              {sorted.length === 0 ? (
                <p className="text-[12px] text-[color:var(--fg-muted)] italic py-2">
                  まだKWがありません。「+ 追加」または「AIで候補提案」で始めましょう。
                </p>
              ) : (
                <div className="space-y-1">
                  {sorted.map((k) => (
                    <KeywordRow
                      key={k.id}
                      keyword={k}
                      busy={busy}
                      onStatus={(s) => updateStatus(k.id, s)}
                      onPriority={(p) => updatePriority(k.id, p)}
                      onDelete={() => deleteKw(k.id)}
                      onGenerateArticle={() => generateFromKw(k.kw, k.themeId, k.subcategoryId)}
                    />
                  ))}
                </div>
              )}

              {/* AI提案結果 */}
              {isSuggesting && suggestions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] font-mono tracking-widest text-[color:var(--accent-dark)] mb-2">
                    AI 提案 ({suggestions.length}件)
                  </div>
                  <div className="space-y-1">
                    {suggestions.map((s) => (
                      <div
                        key={s.kw}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{s.kw}</div>
                          <div className="text-[11px] text-[color:var(--fg-muted)] flex gap-2 flex-wrap">
                            <span>★{s.priority ?? 50}</span>
                            <span>vol:{s.vol ?? "?"}</span>
                            <span>comp:{s.comp ?? "?"}</span>
                            <span>{INTENT_LABEL[(s.intent as KeywordIntent) ?? "trouble"]}</span>
                            {s.memo && <span className="italic">・{s.memo}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => adoptSuggestion(activeTheme, sub.id, s)}
                          disabled={busy === `adopt:${s.kw}`}
                          className="btn-primary text-[11px] shrink-0"
                        >
                          {busy === `adopt:${s.kw}` ? "..." : "+ 採用"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setSuggestForKey(null);
                      setSuggestions([]);
                    }}
                    className="mt-2 text-[11px] text-[color:var(--fg-muted)] hover:underline"
                  >
                    × 提案を閉じる
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      )}
    </>
  );
}

function HotKwRow({
  hot,
  busy,
  alreadyInDict,
  onAdopt,
  onGenerate,
}: {
  hot: HotKeyword;
  busy: string | null;
  alreadyInDict: boolean;
  onAdopt: () => void;
  onGenerate: () => void;
}) {
  const risePalette =
    hot.riseStatus === "rising"
      ? { bg: "#fee2e2", fg: "#991b1b", icon: "🔥" }
      : hot.riseStatus === "stable"
        ? { bg: "#fef3c7", fg: "#92400e", icon: "→" }
        : { bg: "#f3f4f6", fg: "#4b5563", icon: "↓" };
  const volPalette = (() => {
    if (hot.volumeHint === "high") return { bg: "#dcfce7", fg: "#15803d" };
    if (hot.volumeHint === "medium") return { bg: "#fef3c7", fg: "#92400e" };
    if (hot.volumeHint === "low") return { bg: "#fee2e2", fg: "#991b1b" };
    return { bg: "#e0e7ff", fg: "#3730a3" };
  })();
  return (
    <div className="border border-[var(--border-card)] rounded-xl p-4 hover:border-[color:var(--accent-via)] transition bg-white">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full font-mono"
              style={{ background: "#dcfce7", color: "#15803d" }}
            >
              ★{hot.priority}
            </span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: risePalette.bg, color: risePalette.fg }}
            >
              {risePalette.icon} {hot.riseStatus}
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: volPalette.bg, color: volPalette.fg }}
            >
              vol:{hot.volumeHint}
            </span>
            <span className="text-[10px] text-[color:var(--fg-muted)]">
              comp:{hot.competitionHint}
            </span>
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight mb-1">{hot.kw}</h3>
          {hot.whyHot && (
            <p className="text-[11.5px] text-[color:var(--fg-secondary)] italic">
              💡 {hot.whyHot}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onAdopt}
            disabled={busy === `adopt-hot:${hot.kw}` || alreadyInDict}
            className="btn-ghost text-[11px]"
            title={alreadyInDict ? "既に辞書に登録済み" : "辞書に追加"}
          >
            {alreadyInDict
              ? "✓ 辞書済"
              : busy === `adopt-hot:${hot.kw}`
                ? "..."
                : "⊕ 辞書追加"}
          </button>
          <button
            onClick={onGenerate}
            disabled={busy === `gen:${hot.kw}`}
            className="btn-primary text-[11px]"
          >
            {busy === `gen:${hot.kw}` ? "🔍 生成中..." : "📝 記事化"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeywordRow({
  keyword,
  busy,
  onStatus,
  onPriority,
  onDelete,
  onGenerateArticle,
}: {
  keyword: Keyword;
  busy: string | null;
  onStatus: (s: KeywordStatus) => void;
  onPriority: (p: number) => void;
  onDelete: () => void;
  onGenerateArticle: () => void;
}) {
  const sp = STATUS_PALETTE[keyword.status];
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0">
      <select
        value={keyword.status}
        onChange={(e) => onStatus(e.target.value as KeywordStatus)}
        className="text-[10px] font-bold px-2 py-1 rounded border-0 cursor-pointer w-24"
        style={{ background: sp.bg, color: sp.fg }}
      >
        <option value="untargeted">未着手</option>
        <option value="targeted">狙い中</option>
        <option value="covered">Covered</option>
      </select>

      <input
        type="number"
        min="1"
        max="100"
        value={keyword.priority}
        onChange={(e) => onPriority(Math.max(1, Math.min(100, Number(e.target.value) || 50)))}
        className="w-14 px-2 py-1 text-[12px] font-mono tabular-nums rounded border border-[var(--border-card)] bg-white text-center"
      />

      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium truncate">{keyword.kw}</div>
        <div className="text-[10px] text-[color:var(--fg-muted)] flex gap-2 flex-wrap">
          <span>{INTENT_LABEL[keyword.intent]}</span>
          <span>vol:{keyword.vol}</span>
          <span>comp:{keyword.comp}</span>
          {keyword.articleIds.length > 0 && (
            <span className="text-[color:var(--accent-dark)]">
              📝 {keyword.articleIds.length}記事
            </span>
          )}
          {keyword.memo && <span className="italic truncate">・{keyword.memo}</span>}
        </div>
      </div>

      <button
        onClick={onGenerateArticle}
        disabled={busy === `gen:${keyword.kw}`}
        className="btn-primary text-[10.5px] shrink-0"
        title="このKWで記事を作る"
      >
        {busy === `gen:${keyword.kw}` ? "..." : "📝 記事化"}
      </button>

      <button
        onClick={onDelete}
        className="text-[color:var(--fg-muted)] hover:text-red-500 text-base leading-none px-1.5"
        title="削除"
      >
        ×
      </button>
    </div>
  );
}
