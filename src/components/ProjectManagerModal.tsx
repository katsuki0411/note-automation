"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PROJECT_KIND_LABEL,
  type ProjectKind,
  type ProjectMembership,
} from "@/lib/projects-types";

const KIND_ICON: Record<ProjectKind, string> = {
  research_based: "📝",
  amazon_affiliate: "🛒",
  a8_affiliate: "🅰️",
};

// プロジェクトの追加・名前編集・削除を行う管理モーダル。
// バックエンド: POST /api/projects, PATCH/DELETE /api/projects/[id]（owner のみ）。
export default function ProjectManagerModal({
  projects,
  currentSlug,
  onClose,
}: {
  projects: ProjectMembership[];
  currentSlug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 名前編集中の project id → 編集中の表示名
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  // 削除確認中の project id
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // 新規作成フォーム
  const [showAdd, setShowAdd] = useState(false);
  const [newKind, setNewKind] = useState<ProjectKind>("amazon_affiliate");
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveName(id: string, name: string) {
    if (!name.trim()) {
      setError("表示名を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新失敗");
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(p: ProjectMembership) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "削除失敗");
      setConfirmDelete(null);
      // 現在開いているプロジェクトを消したら、プロジェクト選択へ退避
      if (p.slug === currentSlug) {
        router.push("/select-project");
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除失敗");
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    const slug = newSlug.trim();
    const name = newName.trim();
    if (!slug || !name) {
      setError("slug と表示名は必須です");
      return;
    }
    if (!/^[a-z0-9_-]{2,32}$/.test(slug)) {
      setError("slug は半角英小文字・数字・- _ の2〜32文字です");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, displayName: name, kind: newKind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "作成失敗");
      setShowAdd(false);
      setNewSlug("");
      setNewName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[color:var(--fg-primary)]">
            プロジェクト設定
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] text-[18px]"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-50 border border-red-100 text-[11px] text-red-700">
            {error}
          </div>
        )}

        {/* プロジェクト一覧 */}
        <ul className="space-y-2 mb-4">
          {projects.map((p) => {
            const kind = (p.kind ?? "research_based") as ProjectKind;
            const isOwner = p.role === "owner";
            const isCurrent = p.slug === currentSlug;
            return (
              <li
                key={p.id}
                className="rounded-lg border border-[var(--border-subtle)] p-3"
              >
                {editing?.id === p.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editing.name}
                      onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                      className="input-base flex-1 text-[13px]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => saveName(p.id, editing.name)}
                      disabled={busy}
                      className="btn-accent text-[11px] px-2.5 py-1 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="btn-ghost text-[11px] px-2.5 py-1"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      {p.slug}
                    </span>
                    <span className="text-[13px] font-semibold text-[color:var(--fg-primary)] flex-1 min-w-0 truncate">
                      {KIND_ICON[kind]} {p.display_name}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]">
                        表示中
                      </span>
                    )}
                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing({ id: p.id, name: p.display_name })}
                          className="text-[11px] text-[color:var(--accent-dark)] hover:underline shrink-0"
                        >
                          ✎ 名前編集
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(p.id)}
                          disabled={projects.length <= 1}
                          title={projects.length <= 1 ? "最後の1つは削除できません" : undefined}
                          className="text-[11px] text-red-600 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline"
                        >
                          🗑 削除
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-[color:var(--fg-muted)] shrink-0">
                        {p.role}
                      </span>
                    )}
                  </div>
                )}

                {/* 削除確認 */}
                {confirmDelete === p.id && (
                  <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-100">
                    <p className="text-[11px] text-red-700 leading-relaxed mb-2">
                      「{p.display_name}」を削除します。この操作は取り消せません。
                      <b>このプロジェクトの記事・画像・投稿先など全データが完全に消えます。</b>本当によろしいですか？
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => doDelete(p)}
                        disabled={busy}
                        className="text-[11px] px-3 py-1.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
                      >
                        完全に削除する
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="btn-ghost text-[11px] px-3 py-1.5"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* 新規追加 */}
        {showAdd ? (
          <div className="rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] p-3 space-y-2.5">
            <div className="text-[12px] font-semibold text-[color:var(--fg-primary)]">
              新規プロジェクト
            </div>
            <div>
              <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                種類
              </label>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as ProjectKind)}
                className="input-base w-full text-[13px]"
              >
                {(Object.keys(PROJECT_KIND_LABEL) as ProjectKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_ICON[k]} {PROJECT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                slug（URL用ID・半角英小文字/数字/- _）
              </label>
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="例: aff / blog / work"
                className="input-base w-full text-[13px] font-mono"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[color:var(--fg-secondary)] mb-0.5">
                表示名
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: テストプロジェクト"
                className="input-base w-full text-[13px]"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={createProject}
                disabled={busy}
                className="btn-accent text-[12px] px-3 py-1.5 disabled:opacity-50"
              >
                作成
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="btn-ghost text-[12px] px-3 py-1.5"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowAdd(true);
              setError(null);
            }}
            className="btn-accent text-[12px] px-3 py-1.5"
          >
            ＋ 新規プロジェクト
          </button>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-[12px] px-4 py-1.5">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
