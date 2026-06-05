"use client";

import { useEffect, useState } from "react";

// =========================================================
// アカウントタブ
// =========================================================
// マスター(env MASTER_USER_EMAIL)がスタッフ用ログインを発行する画面。
// マスター以外がアクセスすると 403 → 「マスターのみ操作可」案内を表示。
// =========================================================

type SubAccount = {
  id: string;
  sub_user_id: string;
  sub_email: string;
  created_at: string;
  role: string | null;
  project_names: string[];
};

type ListResponse = {
  subAccounts: SubAccount[];
  master: { email: string | null };
};

function generatePassword(length = 14): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

export default function AccountsTab() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [masterEmail, setMasterEmail] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as ListResponse;
      setSubAccounts(data.subAccounts ?? []);
      setMasterEmail(data.master?.email ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createSubAccount() {
    setError(null);
    if (!newEmail.trim() || !newPassword.trim()) {
      setError("メアドとパスワードを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "作成失敗");
      setLastCreated({ email: newEmail.trim(), password: newPassword });
      setNewEmail("");
      setNewPassword("");
      setShowCreateForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteAccount(sa: SubAccount) {
    if (!confirm(`サブアカウント ${sa.sub_email} を削除しますか?\nこのアカウントは即座にログイン不可になります。`)) return;
    try {
      const res = await fetch(`/api/accounts/${sa.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "削除失敗");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除失敗");
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-2xl">
        <div className="p-6 rounded-lg border border-orange-200 bg-orange-50 text-[13px] text-orange-800 leading-relaxed">
          <div className="font-semibold mb-1">🔒 マスターのみアクセス可能</div>
          このタブは <code className="text-[11px] bg-white px-1 py-0.5 rounded">MASTER_USER_EMAIL</code> 環境変数で指定されたマスターアカウントのみが操作できます。
          スタッフ用ログインの追加・削除はマスターに依頼してください。
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="section-title">アカウント管理</h2>
      </div>

      {/* マスター情報 */}
      <div className="p-3 rounded-lg bg-[color:var(--accent-soft)] border border-[color:var(--accent)]/30">
        <div className="text-[10px] font-mono tracking-widest text-[color:var(--accent-dark)] mb-0.5">
          MASTER
        </div>
        <div className="text-[13px] font-semibold text-[color:var(--fg-primary)]">
          {masterEmail ?? "(読み込み中)"}
        </div>
        <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5">
          MASTER_USER_EMAIL 環境変数で指定されています
        </div>
      </div>

      {/* 新規発行直後の表示 (パスワードを1回だけ見せる) */}
      {lastCreated && (
        <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold text-green-800">
              ✅ サブアカウントを発行しました
            </div>
            <button
              type="button"
              onClick={() => setLastCreated(null)}
              className="text-[11px] text-green-700 hover:underline"
            >
              ✕ 閉じる
            </button>
          </div>
          <div className="text-[11px] text-green-800">
            この情報をスタッフに渡してください。<strong>パスワードは今だけ表示されます</strong>。
          </div>
          <div className="bg-white rounded p-2 font-mono text-[11px] space-y-1">
            <div>メアド: <strong>{lastCreated.email}</strong></div>
            <div>パスワード: <strong>{lastCreated.password}</strong></div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(
                `MultiPostAI ログイン情報\nメアド: ${lastCreated.email}\nパスワード: ${lastCreated.password}`,
              );
            }}
            className="text-[11px] px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
          >
            📋 コピー
          </button>
        </div>
      )}

      {/* サブアカウント一覧 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-[color:var(--fg-secondary)]">
            サブアカウント ({subAccounts.length})
          </h3>
          {!showCreateForm && (
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(true);
                setNewPassword(generatePassword());
                setError(null);
              }}
              className="btn-accent text-[12px]"
            >
              + サブアカウント追加
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
        ) : subAccounts.length === 0 ? (
          <div className="text-[12px] text-[color:var(--fg-muted)] italic p-4 border border-dashed border-[var(--border-card)] rounded-lg text-center">
            まだサブアカウントがありません
          </div>
        ) : (
          <ul className="space-y-2">
            {subAccounts.map((sa) => (
              <li
                key={sa.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[color:var(--fg-primary)] truncate">
                    {sa.sub_email}
                  </div>
                  <div className="text-[11px] text-[color:var(--fg-muted)] truncate">
                    {sa.role ?? "—"} ·{" "}
                    {sa.project_names.length > 0
                      ? sa.project_names.join(" / ")
                      : "未参加"}
                  </div>
                  <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5">
                    作成日:{" "}
                    {new Date(sa.created_at).toLocaleString("ja-JP", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteAccount(sa)}
                  className="text-[12px] text-red-500 hover:text-red-700 shrink-0"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 新規作成フォーム */}
      {showCreateForm && (
        <div className="space-y-3 p-4 rounded-lg border border-dashed border-[var(--border-card)]">
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            NEW SUB ACCOUNT
          </div>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">
              スタッフのメアド
            </span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="例: staff@example.com"
              className="input-base mt-1 font-mono"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-[color:var(--fg-secondary)]">
              初回パスワード (自動生成済・必要なら手動で変更可)
            </span>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-base flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => setNewPassword(generatePassword())}
                className="text-[11px] px-3 rounded bg-gray-100 hover:bg-gray-200 shrink-0"
                title="再生成"
              >
                🎲 再生成
              </button>
            </div>
            <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
              スタッフに渡した後は初回ログインでスタッフ自身に変更してもらうのが推奨
            </span>
          </label>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setError(null);
              }}
              className="btn-ghost"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={createSubAccount}
              disabled={submitting}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {submitting ? "発行中…" : "発行"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
