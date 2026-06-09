"use client";

import { useEffect, useState } from "react";

type ArticleGenConfig = {
  prompts?: [string, string, string];
};

const PLACEHOLDER = [
  "1段目プロンプト: 例) この記事の骨組みを箇条書きで作ってください。読者は主婦、商品は…",
  "2段目プロンプト: 例) 上の骨組みを元に、本文を800〜1200字で書いてください。実体験を含めて…",
  "3段目プロンプト: 例) 上の本文を、見出し / CTA / タグを整えた最終形にしてください。",
];

export default function ArticleGenConfigTab() {
  const [prompts, setPrompts] = useState<[string, string, string]>(["", "", ""]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({ kind: "idle" });

  useEffect(() => {
    fetch("/api/projects/article-gen-config")
      .then((r) => r.json())
      .then((d) => {
        const cfg: ArticleGenConfig = d.config ?? {};
        const arr = (cfg.prompts ?? ["", "", ""]) as [string, string, string];
        setPrompts([arr[0] ?? "", arr[1] ?? "", arr[2] ?? ""]);
      })
      .catch((e) => setStatus({ kind: "error", message: e instanceof Error ? e.message : "読込失敗" }))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/projects/article-gen-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts }),
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

  const activeCount = prompts.filter((p) => p.trim().length > 0).length;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="section-title">記事生成プロンプト (3段チェーン)</h2>
        <p className="text-[12px] text-[color:var(--fg-secondary)] mt-1 leading-relaxed">
          3段プロンプトを順番に Gemini に通すことで記事精度を上げる仕組み。
          1段目の出力を2段目の入力に、2段目の出力を3段目の入力に流し込みます。
          空欄の段はスキップされ、全段空欄なら従来通り1段で生成します。
        </p>
        {loading && (
          <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">⏳ 設定読込中…</p>
        )}
        {!loading && (
          <p className="text-[11px] text-[color:var(--accent-dark)] mt-1">
            現在: {activeCount === 0 ? "1段モード (従来)" : `${activeCount}段チェーンモード`}
          </p>
        )}
      </div>

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
                  prompts[i].trim().length > 0
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {prompts[i].trim().length > 0 ? "有効" : "空 (スキップ)"}
              </span>
            </div>
            <textarea
              value={prompts[i]}
              onChange={(e) => {
                const next = [...prompts] as [string, string, string];
                next[i] = e.target.value;
                setPrompts(next);
              }}
              rows={20}
              spellCheck={false}
              placeholder={PLACEHOLDER[i]}
              className="flex-1 text-[12px] font-mono leading-[1.6] px-3 py-2 bg-white border-0 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 rounded-b-xl resize-y"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? "保存中..." : "💾 保存"}
        </button>
        {status.kind === "saved" && (
          <span className="text-[12px] text-[color:var(--accent-dark)]">✓ {status.message}</span>
        )}
        {status.kind === "error" && (
          <span className="text-[12px] text-red-700">❌ {status.message}</span>
        )}
      </div>
    </div>
  );
}
