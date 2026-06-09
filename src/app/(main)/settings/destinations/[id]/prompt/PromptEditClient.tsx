"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

// 2026-06-09: 10項目構造化UI から 3段プロンプトUI に置換。
// destination 単位で「3段プロンプトチェーン」を編集する。
// 1段目の出力 → 2段目の入力 → 2段目の出力 → 3段目の入力 → 最終投稿内容
//
// 既存 destination.prompt_config に格納されていた 10項目スキーマ
// (role/authorProfile/audience/... など) は後方互換のため触らず残置し、
// 新しい prompt_config.stages フィールドに 3段プロンプトを保存する。
// /api/generate 側でも stages 優先 → 旧10項目フォールバック → project article_gen_config
// の順に解決する設計 (B-5 で実装)。

const PLACEHOLDER = [
  "1段目プロンプト: 例) この記事の骨組みを箇条書きで作ってください。読者は…",
  "2段目プロンプト: 例) 上の骨組みを元に、本文を800〜1200字で書いてください。実体験を含めて…",
  "3段目プロンプト: 例) 上の本文を、見出し / CTA / タグを整えた最終形にしてください。",
];

type Props = {
  destinationId: string;
  destinationLabel: string;
  platformLabel: string;
  initialPromptConfig: Record<string, string | string[] | undefined>;
};

export default function PromptEditClient({
  destinationId,
  destinationLabel,
  platformLabel,
  initialPromptConfig,
}: Props) {
  // stages = [stage1, stage2, stage3]
  const initialStages: [string, string, string] = (() => {
    const s = initialPromptConfig?.stages;
    if (Array.isArray(s) && s.length === 3) {
      return [s[0] ?? "", s[1] ?? "", s[2] ?? ""] as [string, string, string];
    }
    return ["", "", ""];
  })();

  const [stages, setStages] = useState<[string, string, string]>(initialStages);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({
    kind: "idle",
  });

  // 旧10項目スキーマがあるかどうかを表示するためのフラグ
  const [hasLegacyConfig, setHasLegacyConfig] = useState(false);

  useEffect(() => {
    const keys = [
      "role",
      "authorProfile",
      "audience",
      "tone",
      "dos",
      "donts",
      "structure",
      "cta",
      "platformConstraints",
      "customNotes",
    ];
    const legacy = keys.some((k) => {
      const v = initialPromptConfig?.[k];
      return typeof v === "string" && v.trim().length > 0;
    });
    setHasLegacyConfig(legacy);
  }, [initialPromptConfig]);

  const activeCount = stages.filter((p) => p.trim().length > 0).length;

  async function save() {
    setSaving(true);
    setStatus({ kind: "idle" });
    try {
      // 既存の prompt_config に stages を追加する形 (旧10項目は保持)
      const promptConfig: Record<string, unknown> = {
        ...initialPromptConfig,
        stages,
      };
      const res = await fetch(`/api/destinations/${destinationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失敗");
      setStatus({ kind: "saved", message: "保存しました" });
      setTimeout(() => setStatus({ kind: "idle" }), 2500);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "保存失敗" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${destinationLabel} のプロンプト編集`}
        description={`プラットフォーム: ${platformLabel} / この投稿先で記事生成する時に使う「3段プロンプトチェーン」を編集します。`}
      />

      <div className="max-w-6xl space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href="/settings"
            className="text-[12px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)]"
          >
            ← 設定 (投稿先) に戻る
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[color:var(--accent-dark)]">
              現在: {activeCount === 0 ? "1段モード (空)" : `${activeCount}段チェーンモード`}
            </span>
            {status.kind === "saved" && (
              <span className="text-[11px] text-[color:var(--accent-dark)]">✓ {status.message}</span>
            )}
            {status.kind === "error" && (
              <span className="text-[11px] text-red-700">❌ {status.message}</span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? "保存中…" : "💾 保存"}
            </button>
          </div>
        </div>

        {hasLegacyConfig && (
          <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3">
            ⚠ この投稿先には旧スキーマ (役割 / 著者プロフィール / ターゲット読者 等の10項目)
            の設定が残っています。新規の 3段プロンプトを保存すると、生成時は 3段プロンプトが
            優先されます (旧スキーマは保存データとしては残置)。
          </div>
        )}

        {/* 3カラム構成 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col rounded-xl border border-[var(--border-subtle)] bg-white"
            >
              <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <span className="text-[11px] font-mono tracking-widest text-[color:var(--fg-muted)]">
                  STAGE {i + 1}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    stages[i].trim().length > 0
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {stages[i].trim().length > 0 ? "有効" : "空 (スキップ)"}
                </span>
              </div>
              <textarea
                value={stages[i]}
                onChange={(e) => {
                  const next = [...stages] as [string, string, string];
                  next[i] = e.target.value;
                  setStages(next);
                }}
                rows={22}
                spellCheck={false}
                placeholder={PLACEHOLDER[i]}
                className="flex-1 text-[12px] font-mono leading-[1.6] px-3 py-2 bg-white border-0 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 rounded-b-xl resize-y"
              />
            </div>
          ))}
        </div>

        <div className="text-[11px] text-[color:var(--fg-muted)] leading-relaxed">
          このプロンプトは{platformLabel}「{destinationLabel}」専用です。
          記事生成時には destination のプロンプトが project 単位の
          <Link href="/library" className="underline text-[color:var(--accent-dark)] mx-1">
            ライブラリ → 記事生成プロンプト
          </Link>
          より優先されます。全段空欄なら project プロンプトを使い、両方空なら従来通り 1段生成。
        </div>
      </div>
    </>
  );
}
