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
import { pingExtension } from "@/lib/notePost";

type ExtensionStatus = "unknown" | "checking" | "installed" | "missing";

// 新規追加 / 編集対象から除外するプラットフォーム:
// note は project 作成時に自動投入で1個だけなので新規追加させない
const ADD_EXCLUDED_PLATFORMS = new Set<Platform>(["note"]);

function maskValue(v: string | undefined): string {
  if (!v || v.length < 4) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
}

function isPromptConfigured(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  return Object.values(cfg as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}

// hatena の blogDomain だけ特別に正規化 (https:// / 末尾/ を除去)
function normalizeBlogDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function summarizeConfig(d: PostingDestinationRow): string {
  if (d.platform === "note") return "Chrome 拡張経由で投稿 (接続情報なし)";
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

  async function checkExtension() {
    setExtStatus("checking");
    setExtVersion(null);
    const r = await pingExtension(1500);
    setExtStatus(r.installed ? "installed" : "missing");
    if (r.version) setExtVersion(r.version);
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

  useEffect(() => {
    refresh();
    checkExtension();
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
    setSubmitting(true);
    try {
      const isEdit = typeof editingId === "string";
      const res = await fetch(
        isEdit ? `/api/destinations/${editingId}` : "/api/destinations",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? { label: label.trim(), config: cleanConfig }
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

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="section-title mb-1">投稿先</h2>
        <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
          マルチポスト対象の外部ブログを登録します。note は project ごとに自動で1個用意されています。
        </p>
      </div>

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
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-lg border border-[var(--border-subtle)]"
              >
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] shrink-0">
                  {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[color:var(--fg-primary)] truncate">
                    {d.label}
                  </div>
                  <div className="text-[11px] font-mono text-[color:var(--fg-muted)] truncate">
                    {summarizeConfig(d)}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
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
                  </div>
                  {!isPromptConfigured(d.prompt_config) && (
                    <div className="text-[10px] text-orange-600 mt-0.5">
                      ⚠ プロンプトが入っていません — 記事生成不可
                    </div>
                  )}
                  {d.platform === "ameba" && (
                    <div className="text-[10px] text-red-700 mt-0.5 leading-snug">
                      ⚠ Amazon / A8 等の外部ASPアフィリンクは Ameba 規約違反 (記事削除・凍結リスク)。Ameba Pick 経由のみ可
                    </div>
                  )}
                </div>
                {d.platform === "note" && (
                  <>
                    <span
                      className={`text-[11px] px-2 py-1 rounded shrink-0 ${
                        extStatus === "installed"
                          ? "bg-green-100 text-green-700"
                          : extStatus === "missing"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-500"
                      }`}
                      title={extVersion ? `拡張 v${extVersion}` : undefined}
                    >
                      {extStatus === "installed"
                        ? `✅ 拡張${extVersion ? ` v${extVersion}` : ""}`
                        : extStatus === "missing"
                          ? "❌ 拡張未検出"
                          : extStatus === "checking"
                            ? "⏳ 確認中"
                            : "❔ 未確認"}
                    </span>
                    <button
                      type="button"
                      onClick={checkExtension}
                      disabled={extStatus === "checking"}
                      className="text-[11px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 shrink-0 disabled:opacity-50"
                    >
                      再確認
                    </button>
                  </>
                )}
                <Link
                  href={`/settings/destinations/${d.id}/prompt`}
                  className="text-[11px] px-2 py-1 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white shrink-0"
                >
                  プロンプト
                </Link>
                <button
                  type="button"
                  onClick={() => toggleEnabled(d)}
                  className={`text-[11px] px-2 py-1 rounded ${
                    d.enabled
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {d.enabled ? "有効" : "無効"}
                </button>
                {d.platform !== "note" && (
                  <button
                    type="button"
                    onClick={() => startEdit(d)}
                    className="text-[12px] text-[color:var(--accent-dark)] hover:underline shrink-0"
                  >
                    接続
                  </button>
                )}
                {d.platform !== "note" && (
                  <button
                    type="button"
                    onClick={() => deleteDest(d)}
                    className="text-[12px] text-red-500 hover:text-red-700 shrink-0"
                  >
                    削除
                  </button>
                )}
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
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            {isEditMode ? "EDIT DESTINATION" : "NEW DESTINATION"}
          </div>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">プラットフォーム</span>
            <select
              value={platform}
              onChange={(e) => changePlatform(e.target.value as Platform)}
              disabled={isEditMode}
              className="input-base mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {addablePlatforms.map((p) => (
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
          {currentSchema?.fields.map((f) => (
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
          ))}
          {currentSchema?.notImplementedYet && (
            <div className="text-[11px] text-orange-700 bg-orange-50 p-2 rounded">
              ⚠ {PLATFORM_LABELS[platform]} は接続情報の保存はできますが、サーバーからの自動投稿はまだ実装されていません (Phase 4 で順次対応予定)。プロンプト編集と prompt_config の保存だけ先に行えます。
            </div>
          )}
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
              {submitting ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
