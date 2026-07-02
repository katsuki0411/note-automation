"use client";

import { useEffect, useState } from "react";

// 共通仕様B (writer_*) に対応する構造化フィールド (writer_name は name を流用)。
export type AuthorPersonaFields = {
  title?: string;
  expertise?: string;
  achievements?: string;
  firstPerson?: string;
  tone?: string;
  values?: string;
  episodes?: string;
  vocab?: string;
  ng?: string;
  profileUrl?: string;
  photoUrl?: string;
};

export type AuthorPersona = {
  id: string;
  name: string;
  fields: AuthorPersonaFields;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type EditState = { id: string | null; name: string; fields: AuthorPersonaFields; body: string };

// 短文1行フィールドの定義 (2カラムグリッドで並べる)
const TEXT_FIELDS: { key: keyof AuthorPersonaFields; label: string; placeholder: string }[] = [
  { key: "title", label: "肩書き", placeholder: "元ベビー用品店員×現役ママ" },
  { key: "expertise", label: "専門領域", placeholder: "育児・節約・時短" },
  { key: "firstPerson", label: "一人称", placeholder: "私" },
  { key: "tone", label: "口調・文体", placeholder: "やさしく寄り添う／断定しすぎない" },
  { key: "values", label: "価値観・スタンス", placeholder: "読者の生活を一番に考える" },
  { key: "achievements", label: "主な実績・経歴", placeholder: "ベビー用品店5年勤務、2児の母" },
  { key: "vocab", label: "よく使う言い回し", placeholder: "〜なんです／〜してみてくださいね" },
  { key: "ng", label: "NG表現・禁止事項", placeholder: "断定・誇張・上から目線" },
  { key: "profileUrl", label: "プロフィール/SNS URL", placeholder: "https://..." },
  { key: "photoUrl", label: "顔写真URL", placeholder: "https://..." },
];

const EMPTY_EDIT: EditState = { id: null, name: "", fields: {}, body: "" };

// 執筆者ペルソナの「割り当て + ライブラリ管理」モーダル。
// 各 destination の「ペルソナ」ボタンから開く。
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

  const [editing, setEditing] = useState<EditState | null>(null);
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
        body: JSON.stringify({
          name: editing.name.trim(),
          fields: editing.fields,
          body: editing.body,
        }),
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

  const setField = (key: keyof AuthorPersonaFields, value: string) =>
    setEditing((e) => (e ? { ...e, fields: { ...e.fields, [key]: value } } : e));

  // 一覧プレビュー用の1行サマリ
  const summaryOf = (p: AuthorPersona) =>
    [p.fields.title, p.fields.expertise].filter(Boolean).join(" / ") ||
    p.body ||
    "（プロフィール未入力）";

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
                  onClick={() => setEditing({ ...EMPTY_EDIT })}
                  className="btn-accent text-[11px] px-2.5 py-1"
                >
                  ＋ 新規作成
                </button>
              )}
            </div>

            {/* 編集 / 新規フォーム (構造化) */}
            {editing && (
              <div className="p-3 rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] space-y-2.5 mb-3">
                <div>
                  <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                    ペルソナ名（＝執筆者名）<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="田村 結衣"
                    className="input-base w-full text-[13px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEXT_FIELDS.map((f) => (
                    <div key={f.key}>
                      <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                        {f.label}
                      </label>
                      <input
                        type="text"
                        value={editing.fields[f.key] ?? ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        className="input-base w-full text-[12.5px]"
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                    典型エピソード・一次体験（E-E-A-Tの「経験」になる素材）
                  </label>
                  <textarea
                    value={editing.fields.episodes ?? ""}
                    onChange={(e) => setField("episodes", e.target.value)}
                    placeholder="店員時代、空き箱だけ持ってきて『シール捨てちゃった』というお客様が多かった…など"
                    rows={3}
                    className="input-base w-full text-[12.5px] leading-relaxed resize-y"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                    その他補足（自由記述・任意）
                  </label>
                  <textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    placeholder="上記項目に収まらない人物像の補足があれば自由に記述"
                    rows={2}
                    className="input-base w-full text-[12.5px] leading-relaxed resize-y"
                  />
                </div>

                <div className="flex items-center gap-2 pt-0.5">
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
                      <p className="text-[11px] text-[color:var(--fg-secondary)] mt-0.5 line-clamp-2">
                        {summaryOf(p)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: p.id, name: p.name, fields: { ...p.fields }, body: p.body })
                        }
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
