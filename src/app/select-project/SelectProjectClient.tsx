"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProjectMembership, ProjectPersonaKind } from "@/lib/projects";
import { selectProject } from "./actions";

type Props = {
  userEmail: string;
  projects: ProjectMembership[];
};

const KIND_LABEL: Record<ProjectPersonaKind, string> = {
  housewife: "主婦ペルソナ",
  affiliate: "アフィリエイト",
  blog: "雑記ブログ",
  other: "その他",
};

const KIND_HINT: Record<ProjectPersonaKind, string> = {
  housewife: "LINEで送るだけ・主婦専用・AIを直接使わせない (受注ファネル)",
  affiliate: "ジャンル自由・PV / アフィ収益化・CTA控えめ",
  blog: "雑記 / 個人ブランディング向け・トーンは自由",
  other: "後で persona_config から細かく設定",
};

export default function SelectProjectClient({ userEmail, projects }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<ProjectPersonaKind>("housewife");
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

  async function createAndPick() {
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
          personaConfig: { kind },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "失敗");
      // 作成成功 → そのまま選択して "/" へ
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
            note automation
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
              const kind = (p.persona_config?.kind ?? "other") as ProjectPersonaKind;
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
                      {KIND_LABEL[kind] ?? kind}
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

        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="btn-accent">
            + 新しいプロジェクトを作成
          </button>
        ) : (
          <div className="space-y-3 p-5 rounded-lg border border-dashed border-[var(--border-card)]">
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
              NEW PROJECT
            </div>
            <label className="block">
              <span className="text-[11px] text-[color:var(--fg-secondary)]">slug (URL識別子)</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="例: aff, blog, work"
                className="input-base mt-1 font-mono"
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
            <label className="block">
              <span className="text-[11px] text-[color:var(--fg-secondary)]">ペルソナ種別</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ProjectPersonaKind)}
                className="input-base mt-1"
              >
                {(Object.keys(KIND_LABEL) as ProjectPersonaKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                {KIND_HINT[kind]}
              </span>
            </label>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
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
        )}

        {error && !adding && <p className="text-[11px] text-red-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
