"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PLATFORM_LABELS,
  PLATFORM_AFFILIATE_SUPPORT,
  PLATFORM_CONFIG_SCHEMA,
  type Platform,
  type PostingDestinationRow,
} from "@/lib/posters/types";
import { PLATFORM_GUIDES } from "@/lib/posters/setupGuides";
import { pingExtension, getNoteAccount, type NoteAccountResult } from "@/lib/notePost";
import { isPromptConfigConfigured } from "@/lib/promptResolver";
import SetupGuideModal from "./SetupGuideModal";
import PersonaManagerModal from "./PersonaManagerModal";
import NoteAccountModal from "./NoteAccountModal";

type TestStatus = "idle" | "running" | "ok" | "ng";
type TestResult = { status: TestStatus; error?: string; note?: string };

type ExtensionStatus = "unknown" | "checking" | "installed" | "missing";

// 新規追加 / 編集対象から除外するプラットフォーム:
// note は project 作成時に自動投入で1個だけなので新規追加させない
const ADD_EXCLUDED_PLATFORMS = new Set<Platform>(["note"]);

function maskValue(v: string | undefined): string {
  if (!v || v.length < 4) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
}

// プロンプト有無の判定は記事生成 (/api/generate) と同じ正規ロジックを使う。
// 旧ローカル実装は stages 配列を見ておらず「入れたのに未設定」と誤表示していた (2026-06-21 修正)。
function isPromptConfigured(cfg: unknown): boolean {
  return isPromptConfigConfigured({ prompt_config: cfg });
}

// hatena の blogDomain だけ特別に正規化 (https:// / 末尾/ を除去)
function normalizeBlogDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

// note 投稿先に登録された「想定 note アカウントID」(urlname)。
// 明示登録(config.noteId)を優先し、無ければ自分のURL(https://note.com/<id>/)から推定。
function noteIdOf(d: PostingDestinationRow): string {
  const cfg = d.config as { noteId?: string; myUrlPrefix?: string };
  if (cfg.noteId?.trim()) return cfg.noteId.trim().replace(/^@/, "");
  const m = (cfg.myUrlPrefix ?? "").match(/note\.com\/([^/?#]+)/i);
  return m ? m[1] : "";
}

function summarizeConfig(d: PostingDestinationRow): string {
  if (d.platform === "note") {
    const id = noteIdOf(d);
    const parts = ["Chrome 拡張経由"];
    if (id) parts.push(`設定アカウント: @${id}`);
    else parts.push("note ID 未登録");
    return parts.join(" · ");
  }
  if (d.platform === "blogger") {
    const cfg = d.config as {
      blogId?: string;
      blogName?: string;
      blogUrl?: string;
      refreshToken?: string;
    };
    if (!cfg.refreshToken) return "⚠ 未連携 — 「再連携」ボタンから Google 連携してください";
    return `${cfg.blogName ?? cfg.blogId ?? "?"}${cfg.blogUrl ? ` (${cfg.blogUrl})` : ""}`;
  }
  const schema = PLATFORM_CONFIG_SCHEMA[d.platform];
  if (!schema || schema.fields.length === 0) return "—";
  const cfg = d.config as Record<string, string>;
  return schema.fields
    .map((f) => {
      const v = cfg[f.key] ?? "";
      const shown = f.type === "password" ? `${f.label}:${maskValue(v)}` : `${f.label}:${v || "—"}`;
      return shown;
    })
    .join(" / ");
}

export default function DestinationsTab() {
  const [destinations, setDestinations] = useState<PostingDestinationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [platform, setPlatform] = useState<Platform>("hatena");
  const [label, setLabel] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extStatus, setExtStatus] = useState<ExtensionStatus>("unknown");
  const [extVersion, setExtVersion] = useState<string | null>(null);
  // 拡張が読み取った「今 note.com にログイン中のアカウント」(v0.2.1+)。
  const [noteAccount, setNoteAccount] = useState<NoteAccountResult | null>(null);
  // 各 destination の接続テスト結果
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  // 取得手順ガイドモーダル (platform を渡せば開く)
  const [guideOpen, setGuideOpen] = useState<Platform | null>(null);
  // 執筆者ペルソナ管理モーダル (対象 destination を渡せば開く)
  const [personaDest, setPersonaDest] = useState<PostingDestinationRow | null>(null);
  // note アカウント切替ガイドモーダルの対象 destination
  const [accountDest, setAccountDest] = useState<PostingDestinationRow | null>(null);
  // Blogger OAuth コールバックからのフラッシュメッセージ
  const [flash, setFlash] = useState<{ type: "ok" | "ng"; msg: string } | null>(null);

  async function runTest(d: PostingDestinationRow) {
    setTests((s) => ({ ...s, [d.id]: { status: "running" } }));
    try {
      const res = await fetch(`/api/destinations/${d.id}/test`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; error?: string; note?: string };
      setTests((s) => ({
        ...s,
        [d.id]: {
          status: data.ok ? "ok" : "ng",
          error: data.error,
          note: data.note,
        },
      }));
    } catch (e) {
      setTests((s) => ({
        ...s,
        [d.id]: { status: "ng", error: e instanceof Error ? e.message : "失敗" },
      }));
    }
  }

  async function checkExtension() {
    setExtStatus("checking");
    setExtVersion(null);
    setNoteAccount(null);
    const r = await pingExtension(1500);
    setExtStatus(r.installed ? "installed" : "missing");
    if (r.version) setExtVersion(r.version);
    // 拡張が入っていれば、今ログイン中の note アカウントも取得して一致判定に使う
    if (r.installed) {
      setNoteAccount(await getNoteAccount());
    }
  }

  // note 投稿先の総合ステータス: 拡張 + note ログイン + 登録IDの一致を判定。
  // ok=true で「有効」、それ以外は reason に無効理由を入れる。
  type NoteStatus = { state: "ok" | "warn" | "neutral"; badge: string; reason?: string };
  function computeNoteStatus(d: PostingDestinationRow): NoteStatus {
    if (extStatus === "checking") return { state: "neutral", badge: "⏳ 確認中" };
    if (extStatus === "unknown") return { state: "neutral", badge: "❔ 未確認" };
    if (extStatus === "missing") {
      return {
        state: "warn",
        badge: "⚠ 無効: 拡張未検出",
        reason: "Chrome 拡張が見つかりません。「拡張DL」からダウンロード→解凍→chrome://extensions で読み込んでください。",
      };
    }
    const regId = noteIdOf(d);
    if (!regId) {
      return {
        state: "warn",
        badge: "⚠ 無効: note ID未登録",
        reason: "この投稿先の note ID（投稿先アカウント）が未登録です。「✎ 編集」から登録してください。",
      };
    }
    if (!noteAccount) return { state: "neutral", badge: "⏳ アカウント確認中" };
    if (!noteAccount.ok || !noteAccount.loggedIn) {
      return {
        state: "warn",
        badge: "⚠ 無効: note未ログイン",
        reason: noteAccount.error ?? "note.com にログインしてください。",
      };
    }
    const loginId = (noteAccount.urlname ?? "").replace(/^@/, "");
    if (loginId.toLowerCase() !== regId.toLowerCase()) {
      return {
        state: "warn",
        badge: "⚠ 無効: アカウント不一致",
        reason: `設定: @${regId} ／ ログイン中: @${loginId}。note.com で @${regId} にログインし直してください（「アカウント切替」参照）。`,
      };
    }
    return { state: "ok", badge: `✅ 有効 @${loginId}` };
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/destinations");
      const data = await res.json();
      setDestinations(data.destinations ?? []);
    } finally {
      setLoading(false);
    }
  }

  // destination にペルソナを割り当てる (prompt_config.personaId を更新)。
  // 既存の prompt_config (stages 等) は保持する。
  async function assignPersona(d: PostingDestinationRow, personaId: string | null) {
    const nextConfig = {
      ...((d.prompt_config as Record<string, unknown> | null) ?? {}),
      personaId: personaId ?? undefined,
    };
    const res = await fetch(`/api/destinations/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptConfig: nextConfig }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "ペルソナ割り当て失敗");
    }
    // ローカル state を即時反映 (モーダルの選択 + カード表示の同期)
    setDestinations((ds) =>
      ds.map((x) => (x.id === d.id ? { ...x, prompt_config: nextConfig } : x)),
    );
    setPersonaDest((cur) => (cur && cur.id === d.id ? { ...cur, prompt_config: nextConfig } : cur));
  }

  useEffect(() => {
    refresh();
    checkExtension();
    // Blogger OAuth コールバックのフラッシュメッセージを拾う
    if (typeof window !== "undefined") {
      const u = new URLSearchParams(window.location.search);
      const ok = u.get("blogger_ok");
      const err = u.get("blogger_error");
      if (ok) setFlash({ type: "ok", msg: `Bloggerブログ「${ok}」を連携しました 🎉` });
      else if (err) setFlash({ type: "ng", msg: `Blogger 連携失敗: ${err}` });
      if (ok || err) {
        u.delete("blogger_ok");
        u.delete("blogger_error");
        const next = window.location.pathname + (u.toString() ? `?${u}` : "");
        window.history.replaceState({}, "", next);
      }
    }
  }, []);

  function resetForm() {
    setLabel("");
    setConfigValues({});
    setPlatform("hatena");
    setError(null);
    setEditingId(undefined);
  }

  function startAdd() {
    resetForm();
    setEditingId(null);
  }

  function startEdit(d: PostingDestinationRow) {
    setError(null);
    setPlatform(d.platform);
    setLabel(d.label);
    setConfigValues((d.config as Record<string, string>) ?? {});
    setEditingId(d.id);
  }

  function changeConfigField(key: string, value: string) {
    setConfigValues((s) => ({ ...s, [key]: value }));
  }

  function changePlatform(p: Platform) {
    setPlatform(p);
    setConfigValues({});
  }

  async function submitForm() {
    setError(null);
    if (!label.trim()) {
      setError("ラベルを入力してください");
      return;
    }
    // Blogger は通常フォーム保存ではなく OAuth フローへ遷移
    // (新規追加時のみ。既存編集はラベル変更のみなので通常 PATCH ルート)
    if (platform === "blogger" && typeof editingId !== "string") {
      const params = new URLSearchParams({
        label: label.trim(),
        returnTo: "/settings",
      });
      window.location.href = `/api/destinations/blogger/oauth/start?${params.toString()}`;
      return;
    }
    const schema = PLATFORM_CONFIG_SCHEMA[platform];
    const cleanConfig: Record<string, string> = {};
    for (const f of schema?.fields ?? []) {
      const raw = configValues[f.key] ?? "";
      const v =
        platform === "hatena" && f.key === "blogDomain"
          ? normalizeBlogDomain(raw)
          : raw.trim();
      if (!v) {
        setError(`「${f.label}」は必須です`);
        return;
      }
      cleanConfig[f.key] = v;
    }
    // 共通フィールド: 自分の記事URL (任意)。SEO 順位チェックの「自分の記事」判定に使う。
    const myUrlPrefixRaw = (configValues.myUrlPrefix ?? "").trim();
    if (myUrlPrefixRaw) {
      cleanConfig.myUrlPrefix = myUrlPrefixRaw;
    }
    // note 専用: 投稿先アカウントID (@ は除去して urlname だけ保存)。
    if (platform === "note") {
      const noteIdRaw = (configValues.noteId ?? "").trim().replace(/^@/, "");
      if (noteIdRaw) cleanConfig.noteId = noteIdRaw;
    }
    setSubmitting(true);
    try {
      const isEdit = typeof editingId === "string";
      // Blogger 編集モードは label のみ更新 (config を送ると OAuth トークンが空で上書きされてしまう)
      const patchBody =
        platform === "blogger"
          ? { label: label.trim() }
          : { label: label.trim(), config: cleanConfig };
      const res = await fetch(
        isEdit ? `/api/destinations/${editingId}` : "/api/destinations",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? patchBody
              : { platform, label: label.trim(), config: cleanConfig },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      resetForm();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(d: PostingDestinationRow) {
    await fetch(`/api/destinations/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !d.enabled }),
    });
    refresh();
  }

  async function deleteDest(d: PostingDestinationRow) {
    if (!confirm(`「${d.label}」を削除しますか？`)) return;
    await fetch(`/api/destinations/${d.id}`, { method: "DELETE" });
    refresh();
  }

  const formVisible = editingId !== undefined;
  const isEditMode = typeof editingId === "string";
  const currentSchema = PLATFORM_CONFIG_SCHEMA[platform];
  const currentAff = PLATFORM_AFFILIATE_SUPPORT[platform];

  const addablePlatforms: Platform[] = (Object.keys(PLATFORM_LABELS) as Platform[]).filter(
    (p) => !ADD_EXCLUDED_PLATFORMS.has(p),
  );
  // 編集モード時は現 destination の platform が除外リストに入っていても表示する
  // (note は ADD_EXCLUDED に入っているが、編集モードでは select で正しく表示する必要があるため)
  const visiblePlatforms: Platform[] = isEditMode && !addablePlatforms.includes(platform)
    ? [platform, ...addablePlatforms]
    : addablePlatforms;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="section-title">投稿先</h2>
      </div>

      {flash && (
        <div
          className={`p-3 rounded border text-[12px] flex items-center justify-between gap-3 ${
            flash.type === "ok"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <span className="leading-relaxed">{flash.msg}</span>
          <button
            type="button"
            onClick={() => setFlash(null)}
            className="text-[11px] opacity-60 hover:opacity-100 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
      ) : destinations.length > 0 ? (
        <ul className="space-y-2">
          {destinations.map((d) => {
            const aff = PLATFORM_AFFILIATE_SUPPORT[d.platform as Platform];
            const schema = PLATFORM_CONFIG_SCHEMA[d.platform as Platform];
            const notImpl = schema?.notImplementedYet;
            return (
              <li
                key={d.id}
                className="rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-white"
              >
                {/* ヘッダー: 媒体 / 状態 / 有効トグル */}
                <div className="flex items-start gap-3 p-3.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] shrink-0 mt-0.5">
                    {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[color:var(--fg-primary)] truncate">
                      {d.label}
                    </div>
                    <div className="text-[11px] font-mono text-[color:var(--fg-muted)] truncate">
                      {summarizeConfig(d)}
                    </div>
                    {d.platform === "note" &&
                      (() => {
                        const ns = computeNoteStatus(d);
                        return ns.state === "warn" && ns.reason ? (
                          <div className="text-[11px] text-red-600 mt-1 leading-snug">
                            {ns.reason}
                          </div>
                        ) : null;
                      })()}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${aff?.amazon ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                        title={aff?.notes}
                      >
                        Amazon {aff?.amazon ? "✅" : "❌"}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${aff?.a8 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                        title={aff?.notes}
                      >
                        A8 {aff?.a8 ? "✅" : "❌"}
                      </span>
                      {notImpl && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">
                          投稿実装は準備中
                        </span>
                      )}
                      {!isPromptConfigured(d.prompt_config) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">
                          ⚠ プロンプト未設定
                        </span>
                      )}
                    </div>
                    {d.platform === "ameba" && (
                      <div className="text-[10px] text-red-700 mt-1 leading-snug">
                        ⚠ Amazon / A8 等の外部ASPアフィリンクは Ameba 規約違反 (記事削除・凍結リスク)。Ameba Pick 経由のみ可
                      </div>
                    )}
                    {tests[d.id]?.status === "ng" && (tests[d.id]?.error || tests[d.id]?.note) && (
                      <div className="mt-1.5 p-2 rounded bg-red-50 border border-red-100 text-[10px] text-red-700 leading-snug break-all">
                        <div className="font-semibold mb-0.5">接続テスト失敗の詳細:</div>
                        {tests[d.id]?.error ?? tests[d.id]?.note}
                      </div>
                    )}
                    {tests[d.id]?.status === "ok" && (
                      <div className="mt-1 text-[10px] text-green-700">
                        ✓ {tests[d.id]?.note ?? "AtomPub サービス文書を取得できました (認証OK)"}
                      </div>
                    )}
                  </div>
                  {/* 右肩: 接続状態バッジ + 有効トグル */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(d)}
                      className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition ${
                        d.enabled
                          ? "bg-[color:var(--accent)] text-white"
                          : "bg-gray-100 text-gray-400"
                      }`}
                      title={d.enabled ? "クリックで無効化" : "クリックで有効化"}
                    >
                      {d.enabled ? "● 有効" : "○ 無効"}
                    </button>
                    {d.platform === "note" ? (
                      (() => {
                        const ns = computeNoteStatus(d);
                        return (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full ${
                              ns.state === "ok"
                                ? "bg-green-100 text-green-700"
                                : ns.state === "warn"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-500"
                            }`}
                            title={
                              ns.reason ??
                              (extVersion ? `拡張 v${extVersion}` : undefined)
                            }
                          >
                            {ns.badge}
                            {extVersion && ns.state === "ok" ? ` · 拡張 v${extVersion}` : ""}
                          </span>
                        );
                      })()
                    ) : (
                      (() => {
                        const t = tests[d.id];
                        if (!t?.status || t.status === "idle") return null;
                        const label =
                          t.status === "running"
                            ? "⏳ 確認中"
                            : t.status === "ok"
                              ? "✅ 接続OK"
                              : "❌ 失敗";
                        const cls =
                          t.status === "ok"
                            ? "bg-green-100 text-green-700"
                            : t.status === "ng"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600";
                        return (
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full ${cls}`}
                            title={t.error ?? t.note ?? ""}
                          >
                            {label}
                          </span>
                        );
                      })()
                    )}
                  </div>
                </div>

                {/* アクションバー: コンテンツ設定 (左) | ユーティリティ (右) */}
                <div className="flex items-center flex-wrap gap-x-1 gap-y-2 px-3.5 py-2 border-t border-[var(--border-subtle)] bg-gray-50/60">
                  {/* コンテンツ設定 — プロンプト / ペルソナ */}
                  <Link
                    href={`/settings/destinations/${d.id}/prompt`}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white transition shrink-0"
                  >
                    ✏️ プロンプト
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPersonaDest(d)}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition shrink-0 ${
                      (d.prompt_config as { personaId?: string } | null)?.personaId
                        ? "bg-[color:var(--accent)] text-white"
                        : "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white"
                    }`}
                    title="この媒体の執筆者ペルソナを選択・作成"
                  >
                    {(d.prompt_config as { personaId?: string } | null)?.personaId
                      ? "👤 ペルソナ ✓"
                      : "👤 ペルソナ"}
                  </button>

                  {/* 区切り + ユーティリティ群 (右寄せ) */}
                  <div className="ml-auto flex items-center flex-wrap gap-x-1 gap-y-2 justify-end">
                    {d.platform === "note" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setAccountDest(d)}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0"
                          title="投稿先の note アカウントの確認・切替ガイド"
                        >
                          🔁 アカウント切替
                        </button>
                        <button
                          type="button"
                          onClick={checkExtension}
                          disabled={extStatus === "checking"}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0 disabled:opacity-50"
                        >
                          🔄 状態を再チェック
                        </button>
                        <a
                          href="/multipostai-poster-extension.zip"
                          download
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0"
                          title="インストール: 1) zip展開 2) chrome://extensions/ で「デベロッパーモード」ON 3) 「パッケージ化されていない拡張機能を読み込む」で展開フォルダを選択"
                        >
                          📦 拡張DL
                        </a>
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0"
                          title="ラベル・note ID・自分のURL を編集"
                        >
                          ✎ 編集
                        </button>
                      </>
                    )}
                    {d.platform !== "note" && (
                      <>
                        <button
                          type="button"
                          onClick={() => runTest(d)}
                          disabled={tests[d.id]?.status === "running"}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0 disabled:opacity-50"
                        >
                          🔌 接続確認
                        </button>
                        {d.platform === "blogger" && (
                          <a
                            href={`/api/destinations/blogger/oauth/start?destinationId=${d.id}&returnTo=/settings`}
                            className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0"
                          >
                            🔗 再連携
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shrink-0"
                        >
                          {d.platform === "blogger" ? "✎ ラベル" : "⚙ 接続情報"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDest(d)}
                          className="text-[11px] px-2 py-1 rounded-md text-red-500 hover:bg-red-50 transition shrink-0"
                        >
                          🗑 削除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="text-[12px] text-[color:var(--fg-muted)] italic">
          まだ投稿先が登録されていません
        </div>
      )}

      {!formVisible ? (
        <button type="button" onClick={startAdd} className="btn-accent">
          + 投稿先を追加
        </button>
      ) : (
        <div className="space-y-3 p-4 rounded-lg border border-dashed border-[var(--border-card)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
              {isEditMode ? "EDIT DESTINATION" : "NEW DESTINATION"}
            </div>
            {PLATFORM_GUIDES[platform] && (
              <button
                type="button"
                onClick={() => setGuideOpen(platform)}
                className="text-[11px] px-2 py-1 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white"
              >
                📖 接続情報の取り方
              </button>
            )}
          </div>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">プラットフォーム</span>
            <select
              value={platform}
              onChange={(e) => changePlatform(e.target.value as Platform)}
              disabled={isEditMode}
              className="input-base mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {visiblePlatforms.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                  {PLATFORM_CONFIG_SCHEMA[p]?.notImplementedYet ? " (投稿実装準備中)" : ""}
                </option>
              ))}
            </select>
            {currentAff && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${currentAff.amazon ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                >
                  Amazon {currentAff.amazon ? "✅" : "❌"}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${currentAff.a8 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                >
                  A8 {currentAff.a8 ? "✅" : "❌"}
                </span>
                {currentAff.notes && (
                  <span className="text-[10px] text-[color:var(--fg-muted)] basis-full leading-snug mt-0.5">
                    {currentAff.notes}
                  </span>
                )}
              </div>
            )}
          </label>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">表示ラベル</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: メインブログ"
              className="input-base mt-1"
            />
          </label>
          {currentSchema?.oauthOnly ? (
            isEditMode ? (
              <div className="text-[12px] text-blue-900 bg-blue-50 border border-blue-100 p-3 rounded leading-relaxed">
                <div className="font-semibold mb-1">🔗 連携済みのBloggerブログ</div>
                ここではラベルだけ変更できます。連携情報そのもの (別のブログに切替・トークン再発行) を更新したい場合は、一覧画面に戻って「🔗 再連携」を押してください。
              </div>
            ) : (
              <div className="text-[12px] text-blue-900 bg-blue-50 border border-blue-100 p-3 rounded leading-relaxed">
                <div className="font-semibold mb-1">🔗 Google OAuth で連携</div>
                ラベルを入力したら下の「Google で連携」ボタンを押してください。Google のログイン画面に飛び、Blogger の権限を許可すると自動でこのアプリに戻ります。事前の API キー取得などは不要です。
              </div>
            )
          ) : (
            currentSchema?.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="text-[11px] text-[color:var(--fg-secondary)]">{f.label}</span>
                <input
                  type={f.type === "password" ? "password" : "text"}
                  value={configValues[f.key] ?? ""}
                  onChange={(e) => changeConfigField(f.key, e.target.value)}
                  placeholder={
                    isEditMode && f.type === "password"
                      ? "変更しない場合も再入力が必要です"
                      : f.placeholder
                  }
                  className="input-base mt-1 font-mono"
                />
                {f.hint && (
                  <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                    {f.hint}
                  </span>
                )}
              </label>
            ))
          )}
          {currentSchema?.notImplementedYet && (
            <div className="text-[11px] text-orange-700 bg-orange-50 p-2 rounded">
              ⚠ {PLATFORM_LABELS[platform]} は接続情報の保存はできますが、サーバーからの自動投稿はまだ実装されていません (Phase 4 で順次対応予定)。プロンプト編集と prompt_config の保存だけ先に行えます。
            </div>
          )}

          {/* note 専用: 投稿先アカウントID。ログイン中アカウントとの一致判定に使う */}
          {platform === "note" && (
            <label className="block">
              <span className="text-[11px] text-[color:var(--fg-secondary)]">
                note ID（投稿先アカウント）
              </span>
              <input
                type="text"
                value={configValues.noteId ?? ""}
                onChange={(e) => changeConfigField("noteId", e.target.value)}
                placeholder="例: test1234（note.com/〇〇/ の 〇〇 部分）"
                className="input-base mt-1 font-mono"
                autoComplete="off"
              />
              <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                この投稿先のnoteアカウントIDを登録します。実際にブラウザでログイン中のnoteアカウントとこのIDが一致した時だけ「有効」になり、誤爆を防げます。
              </span>
            </label>
          )}

          {/* 共通フィールド: 自分の記事URL (任意) — SEO順位の「自分の記事」判定に使う */}
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">
              自分の記事URL (任意)
            </span>
            <input
              type="url"
              value={configValues.myUrlPrefix ?? ""}
              onChange={(e) => changeConfigField("myUrlPrefix", e.target.value)}
              placeholder={
                platform === "note"
                  ? "例: https://note.com/〇〇〇/"
                  : platform === "hatena"
                    ? "例: https://〇〇〇.hatenablog.com/"
                    : platform === "livedoor"
                      ? "例: https://blog.livedoor.jp/〇〇〇/"
                      : platform === "fc2"
                        ? "例: https://〇〇〇.blog.fc2.com/"
                        : platform === "seesaa"
                          ? "例: https://〇〇〇.seesaa.net/"
                          : platform === "blogger"
                            ? "例: https://〇〇〇.blogspot.com/"
                            : platform === "ameba"
                              ? "例: https://ameblo.jp/〇〇〇/"
                              : "例: https://〇〇〇.com/"
              }
              className="input-base mt-1 font-mono"
            />
            <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
              SEO順位チェックで「自分の記事」と判定するための前方一致URL。設定すると /seo ページのプルダウンに自動で表示されます。
            </span>
          </label>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="btn-ghost">
              キャンセル
            </button>
            <button
              type="button"
              onClick={submitForm}
              disabled={submitting}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {currentSchema?.oauthOnly && !isEditMode
                ? "🔗 Google で連携"
                : submitting
                  ? "保存中…"
                  : "保存"}
            </button>
          </div>
        </div>
      )}
      {guideOpen && (
        <SetupGuideModal platform={guideOpen} onClose={() => setGuideOpen(null)} />
      )}
      {personaDest && (
        <PersonaManagerModal
          destinationLabel={personaDest.label}
          currentPersonaId={
            (personaDest.prompt_config as { personaId?: string } | null)?.personaId
          }
          onAssign={(personaId) => assignPersona(personaDest, personaId)}
          onClose={() => setPersonaDest(null)}
        />
      )}
      {accountDest && (
        <NoteAccountModal
          destinationLabel={accountDest.label}
          onClose={() => setAccountDest(null)}
        />
      )}
    </div>
  );
}
