"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PROJECT_KIND_LABEL,
  PROJECT_KIND_DESCRIPTION,
  type ProjectKind,
  type ProjectMembership,
} from "@/lib/projects-types";
import { selectProject } from "./actions";

type Props = {
  userEmail: string;
  projects: ProjectMembership[];
};

const KIND_ICON: Record<ProjectKind, string> = {
  research_based: "📰",
  amazon_affiliate: "🛒",
  a8_affiliate: "💰",
};

const KIND_HINT_INFOSRC: Record<ProjectKind, string> = {
  research_based:
    "知恵袋 / ガルちゃん / ママスタなどの悩み相談から元ネタを抽出",
  amazon_affiliate: "Amazon の商品検索 / 売れ筋を元ネタとして使用",
  a8_affiliate: "A8.net の案件 / 広告主を元ネタとして使用",
};

type AddState =
  | { phase: "hidden" }
  | { phase: "pick-kind" }
  | { phase: "details"; kind: ProjectKind };

export default function SelectProjectClient({ userEmail, projects }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [add, setAdd] = useState<AddState>({ phase: "hidden" });
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pickProject(s: string) {
    setError(null);
    startTransition(async () => {
      try {
        await selectProject(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : "失敗");
      }
    });
  }

  function startAdd() {
    setSlug("");
    setDisplayName("");
    setError(null);
    setAdd({ phase: "pick-kind" });
  }

  function cancelAdd() {
    setAdd({ phase: "hidden" });
    setError(null);
  }

  function pickKind(kind: ProjectKind) {
    setAdd({ phase: "details", kind });
  }

  async function createAndPick() {
    if (add.phase !== "details") return;
    setError(null);
    if (!slug.trim() || !displayName.trim()) {
      setError("slug と表示名は必須です");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          displayName: displayName.trim(),
          kind: add.kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      await selectProject(slug.trim());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--bg-canvas)]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1">
            MultiPostAI
          </div>
          <h1 className="text-2xl font-bold text-[color:var(--fg-primary)]">
            プロジェクトを選択
          </h1>
          <p className="text-[13px] text-[color:var(--fg-secondary)] mt-2">
            ログイン中: <span className="font-mono">{userEmail}</span>
          </p>
        </div>

        {projects.length > 0 ? (
          <div className="space-y-2 mb-8">
            {projects.map((p) => {
              const kind = (p.kind ?? "research_based") as ProjectKind;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProject(p.slug)}
                  disabled={pending}
                  className="block w-full text-left p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-soft)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]">
                      {p.slug}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {p.role}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">
                      {KIND_ICON[kind] ?? ""} {PROJECT_KIND_LABEL[kind] ?? kind}
                    </span>
                  </div>
                  <div className="mt-2 text-[15px] font-semibold text-[color:var(--fg-primary)]">
                    {p.display_name}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mb-8 p-6 rounded-lg border border-dashed border-[var(--border-card)] text-center">
            <p className="text-[13px] text-[color:var(--fg-secondary)] mb-1">
              所属プロジェクトがありません
            </p>
            <p className="text-[11px] text-[color:var(--fg-muted)]">
              新規プロジェクトを作成すると、あなたが owner として自動登録されます
            </p>
          </div>
        )}

        {add.phase === "hidden" && (
          <button type="button" onClick={startAdd} className="btn-accent">
            + 新しいプロジェクトを作成
          </button>
        )}

        {error && add.phase === "hidden" && (
          <p className="text-[11px] text-red-600 mt-3">{error}</p>
        )}
      </div>

      {/* ===== ダイアログ: タイプ選択 ===== */}
      {add.phase === "pick-kind" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={cancelAdd}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[16px] font-bold text-[color:var(--fg-primary)]">
                プロジェクトタイプを選ぶ
              </h2>
              <button
                type="button"
                onClick={cancelAdd}
                className="text-[11px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)]"
              >
                ✕ 閉じる
              </button>
            </div>
            <p className="text-[12px] text-[color:var(--fg-secondary)] mb-4">
              タイプによって、ネタ収集の方法・専用 UI / API が変わります。後から変更可能。
            </p>
            <div className="space-y-2">
              {(Object.keys(PROJECT_KIND_LABEL) as ProjectKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => pickKind(k)}
                  className="w-full text-left p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-soft)] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[16px]">{KIND_ICON[k]}</span>
                    <span className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                      {PROJECT_KIND_LABEL[k]}
                    </span>
                  </div>
                  <p className="text-[11px] text-[color:var(--fg-secondary)] leading-snug">
                    {PROJECT_KIND_DESCRIPTION[k]}
                  </p>
                  <p className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                    元ネタ源: {KIND_HINT_INFOSRC[k]}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== ダイアログ: 詳細入力 ===== */}
      {add.phase === "details" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={cancelAdd}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-[color:var(--fg-primary)]">
                新規プロジェクト: 基本情報
              </h2>
              <button
                type="button"
                onClick={cancelAdd}
                className="text-[11px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)]"
              >
                ✕ 閉じる
              </button>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[color:var(--accent-soft)]">
              <span className="text-[16px]">{KIND_ICON[add.kind]}</span>
              <span className="text-[13px] font-semibold">
                {PROJECT_KIND_LABEL[add.kind]}
              </span>
              <button
                type="button"
                onClick={() => setAdd({ phase: "pick-kind" })}
                className="ml-auto text-[10px] text-[color:var(--accent-dark)] hover:underline"
              >
                ← タイプを変更
              </button>
            </div>
            <label className="block">
              <span className="text-[11px] text-[color:var(--fg-secondary)]">slug (URL識別子)</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="例: aff / blog / work"
                className="input-base mt-1 font-mono"
                autoFocus
              />
              <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                2-32 文字の英小文字 / 数字 / ハイフン / アンダースコア。後から変更不可
              </span>
            </label>
            <label className="block">
              <span className="text-[11px] text-[color:var(--fg-secondary)]">表示名</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例: アフィリエイト雑記"
                className="input-base mt-1"
              />
            </label>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={cancelAdd}
                className="btn-ghost"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={createAndPick}
                disabled={submitting || pending}
                className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {submitting || pending ? "作成中…" : "作成して使う"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
