"use client";

import { useEffect, useState } from "react";

export type AuthorPersona = {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

// 執筆者ペルソナの「割り当て + ライブラリ管理」モーダル。
// 各 destination の「ペルソナ」ボタンから開く。
// - 上部: この媒体に割り当てるペルソナを選択 (共通ライブラリから)
// - 下部: ペルソナの作成 / 編集 / 削除 (自由記述 1フィールド)
export default function PersonaManagerModal({
  destinationLabel,
  currentPersonaId,
  onAssign,
  onClose,
}: {
  destinationLabel: string;
  currentPersonaId?: string;
  onAssign: (personaId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [personas, setPersonas] = useState<AuthorPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedId, setAssignedId] = useState<string | null>(currentPersonaId ?? null);
  const [assigning, setAssigning] = useState(false);

  // 編集中のペルソナ (null = 新規作成フォーム表示なし)
  const [editing, setEditing] = useState<{ id: string | null; name: string; body: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadPersonas() {
    setLoading(true);
    try {
      const res = await fetch("/api/personas");
      const data = await res.json();
      if (res.ok) setPersonas(data.personas ?? []);
      else setError(data.error ?? "読み込み失敗");
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPersonas();
  }, []);

  async function handleAssign(id: string | null) {
    setAssignedId(id);
    setAssigning(true);
    setError(null);
    try {
      await onAssign(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "割り当て失敗");
    } finally {
      setAssigning(false);
    }
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setError("ペルソナ名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = editing.id === null;
      const res = await fetch(isNew ? "/api/personas" : `/api/personas/${editing.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name.trim(), body: editing.body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失敗");
      setEditing(null);
      await loadPersonas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("このペルソナを削除しますか? (割り当て済みの媒体は未割り当てに戻ります)")) return;
    setError(null);
    try {
      const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "削除失敗");
      if (assignedId === id) await handleAssign(null);
      await loadPersonas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除失敗");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-[color:var(--fg-primary)]">執筆者ペルソナ</h2>
            <p className="text-[11px] text-[color:var(--fg-muted)] mt-0.5">
              「{destinationLabel}」の記事を、選んだ人格で生成します
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] text-[18px]"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="p-2 rounded bg-red-50 border border-red-100 text-[11px] text-red-700">
              {error}
            </div>
          )}

          {/* この媒体への割り当て */}
          <div>
            <h3 className="text-[12px] font-semibold text-[color:var(--fg-primary)] mb-1.5">
              この媒体に使うペルソナ
            </h3>
            <select
              value={assignedId ?? ""}
              disabled={assigning || loading}
              onChange={(e) => handleAssign(e.target.value || null)}
              className="input-base w-full text-[13px]"
            >
              <option value="">（割り当てなし — 従来通り3段プロンプトのみで生成）</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* ライブラリ管理 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[12px] font-semibold text-[color:var(--fg-primary)]">
                ペルソナ ライブラリ
              </h3>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setEditing({ id: null, name: "", body: "" })}
                  className="btn-accent text-[11px] px-2.5 py-1"
                >
                  ＋ 新規作成
                </button>
              )}
            </div>

            {/* 編集 / 新規フォーム */}
            {editing && (
              <div className="p-3 rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] space-y-2 mb-3">
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="ペルソナ名（例: タメ口ママブロガー）"
                  className="input-base w-full text-[13px]"
                />
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  placeholder="あなたは35歳、2児を育てる元保育士のブロガー。節約と時短が得意で、読者に寄り添うやさしい口調で書く。専門用語は避け、自分の体験を交えて…"
                  rows={6}
                  className="input-base w-full text-[13px] leading-relaxed resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-accent text-[12px] px-3 py-1.5 disabled:opacity-40"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="btn-ghost text-[12px] px-3 py-1.5"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}

            {/* 一覧 */}
            {loading ? (
              <div className="text-[12px] text-[color:var(--fg-muted)]">読み込み中…</div>
            ) : personas.length === 0 && !editing ? (
              <div className="text-[12px] text-[color:var(--fg-muted)] py-3 text-center">
                まだペルソナがありません。「＋ 新規作成」で1人目を作りましょう。
              </div>
            ) : (
              <ul className="space-y-2">
                {personas.map((p) => (
                  <li
                    key={p.id}
                    className="p-3 rounded-lg border border-[var(--border-subtle)] flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[color:var(--fg-primary)]">
                          {p.name}
                        </span>
                        {assignedId === p.id && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--accent)] text-white">
                            この媒体に使用中
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[color:var(--fg-secondary)] mt-0.5 line-clamp-2 whitespace-pre-wrap">
                        {p.body || "（本文未入力）"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: p.id, name: p.name, body: p.body })}
                        className="text-[11px] text-[color:var(--accent-dark)] hover:underline"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-[12px] px-4 py-1.5">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
