"use client";

import { useEffect, useState } from "react";
import { PLATFORM_LABELS, type Platform, type PostingDestinationRow } from "@/lib/posters/types";

type HatenaConfigForm = {
  hatenaId: string;
  blogDomain: string;
  apiKey: string;
};

const PLATFORM_OPTIONS: { value: Platform; label: string; help: string }[] = [
  {
    value: "hatena",
    label: PLATFORM_LABELS.hatena,
    help: "AtomPub API 経由で投稿。設定→詳細設定→AtomPub から API キーを取得",
  },
];

const EMPTY_HATENA: HatenaConfigForm = { hatenaId: "", blogDomain: "", apiKey: "" };

function maskKey(key: string | undefined): string {
  if (!key || key.length < 4) return "***";
  return `${key.slice(0, 2)}***${key.slice(-2)}`;
}

// 入力ぶれを吸収して AtomPub URL に使える純粋なホスト名にする
// 例: "https://ally-desu.hatenablog.com/" → "ally-desu.hatenablog.com"
function normalizeBlogDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export default function DestinationsTab() {
  const [destinations, setDestinations] = useState<PostingDestinationRow[]>([]);
  const [loading, setLoading] = useState(true);
  // null = 新規作成 / string = その id を編集 / undefined = フォーム非表示
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [platform, setPlatform] = useState<Platform>("hatena");
  const [label, setLabel] = useState("");
  const [hatena, setHatena] = useState<HatenaConfigForm>(EMPTY_HATENA);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  function resetForm() {
    setLabel("");
    setHatena(EMPTY_HATENA);
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
    if (d.platform === "hatena") {
      const cfg = d.config as { hatenaId?: string; blogDomain?: string; apiKey?: string };
      setHatena({
        hatenaId: cfg.hatenaId ?? "",
        blogDomain: cfg.blogDomain ?? "",
        apiKey: cfg.apiKey ?? "",
      });
    }
    setEditingId(d.id);
  }

  async function submitForm() {
    setError(null);
    if (!label.trim()) {
      setError("ラベルを入力してください");
      return;
    }
    let config: Record<string, unknown>;
    if (platform === "hatena") {
      const id = hatena.hatenaId.trim();
      const domain = normalizeBlogDomain(hatena.blogDomain);
      const key = hatena.apiKey.trim();
      if (!id || !domain || !key) {
        setError("はてなID / ブログURL / APIキーは全て必須です");
        return;
      }
      config = { hatenaId: id, blogDomain: domain, apiKey: key };
    } else {
      setError("未対応のプラットフォーム");
      return;
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
            isEdit ? { label: label.trim(), config } : { platform, label: label.trim(), config },
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

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="section-title mb-1">投稿先</h2>
        <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
          マルチポスト対象の外部ブログを登録します。note は Chrome 拡張経由なのでここでは不要です。
        </p>
      </div>

      {loading ? (
        <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
      ) : destinations.length > 0 ? (
        <ul className="space-y-2">
          {destinations.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-subtle)]"
            >
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]">
                {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[color:var(--fg-primary)] truncate">
                  {d.label}
                </div>
                <div className="text-[11px] font-mono text-[color:var(--fg-muted)] truncate">
                  {d.platform === "hatena"
                    ? `${(d.config as { hatenaId?: string }).hatenaId} / ${(d.config as { blogDomain?: string }).blogDomain} / key:${maskKey((d.config as { apiKey?: string }).apiKey)}`
                    : "—"}
                </div>
              </div>
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
              <button
                type="button"
                onClick={() => startEdit(d)}
                className="text-[12px] text-[color:var(--accent-dark)] hover:underline shrink-0"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => deleteDest(d)}
                className="text-[12px] text-red-500 hover:text-red-700 shrink-0"
              >
                削除
              </button>
            </li>
          ))}
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
              onChange={(e) => setPlatform(e.target.value as Platform)}
              disabled={isEditMode}
              className="input-base mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {PLATFORM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">表示ラベル</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: メインブログ"
              className="input-base mt-1"
            />
            <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
              一覧で識別するための名前（自由入力）
            </span>
          </label>
          {platform === "hatena" && (
            <>
              <label className="block">
                <span className="text-[11px] text-[color:var(--fg-secondary)]">はてなID</span>
                <input
                  value={hatena.hatenaId}
                  onChange={(e) => setHatena({ ...hatena, hatenaId: e.target.value })}
                  placeholder="例: ally-desu"
                  className="input-base mt-1 font-mono"
                />
                <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                  ログイン時に使う本来のはてなID。AtomPub URL の `/blog.hatena.ne.jp/<b>ここ</b>/xxx.hatenablog.com/atom` 部分
                </span>
              </label>
              <label className="block">
                <span className="text-[11px] text-[color:var(--fg-secondary)]">ブログURL</span>
                <input
                  value={hatena.blogDomain}
                  onChange={(e) => setHatena({ ...hatena, blogDomain: e.target.value })}
                  placeholder="例: ally-desu.hatenablog.com"
                  className="input-base mt-1 font-mono"
                />
                <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                  ホスト名のみ。https:// や末尾スラッシュは自動で除去します
                </span>
              </label>
              <label className="block">
                <span className="text-[11px] text-[color:var(--fg-secondary)]">APIキー</span>
                <input
                  type="password"
                  value={hatena.apiKey}
                  onChange={(e) => setHatena({ ...hatena, apiKey: e.target.value })}
                  placeholder={isEditMode ? "変更しない場合も再入力が必要です" : "例: t3zztwzmay"}
                  className="input-base mt-1 font-mono"
                />
                <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                  はてな「アカウント設定」→ APIキー欄に表示される値。投稿用メアド <span className="font-mono">xxxxx.yyyyy@blog.hatena.ne.jp</span> の <span className="font-mono">「.」より左側</span> と同じ
                </span>
              </label>
            </>
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
