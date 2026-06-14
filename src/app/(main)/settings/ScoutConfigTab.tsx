"use client";

import { useEffect, useState } from "react";

type ScoutConfig = {
  kwCandidateCount?: number;
  maxFinalCount?: number;
  minSv?: number;
  minCpc?: number;
  maxKd?: number;
  excludeKws?: string[];
  promptKwGen?: string;
  promptStage3?: string;
  promptFinal?: string;
};

const DEFAULTS: Required<Pick<ScoutConfig, "kwCandidateCount" | "maxFinalCount" | "minSv" | "minCpc" | "maxKd">> = {
  kwCandidateCount: 100,
  maxFinalCount: 10,
  minSv: 100,
  minCpc: 0.2,
  maxKd: 30,
};

export default function ScoutConfigTab() {
  const [config, setConfig] = useState<ScoutConfig>({});
  const [excludeText, setExcludeText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({ kind: "idle" });

  useEffect(() => {
    fetch("/api/projects/scout-config")
      .then((r) => r.json())
      .then((d) => {
        const c: ScoutConfig = d.config ?? {};
        setConfig(c);
        setExcludeText((c.excludeKws ?? []).join("\n"));
      })
      .catch((e) => {
        setStatus({ kind: "error", message: e instanceof Error ? e.message : "読込失敗" });
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setStatus({ kind: "idle" });
    try {
      const excludeKws = excludeText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: ScoutConfig = { ...config, excludeKws };
      const res = await fetch("/api/projects/scout-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="section-title">KWスカウト設定</h2>
        {loading && (
          <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">⏳ 設定読込中…</p>
        )}
      </div>

      {/* 件数 / 閾値 */}
      <details className="rounded-xl border border-[var(--border-subtle)] bg-white" open>
        <summary className="cursor-pointer px-4 py-3 font-semibold text-[13px]">
          ⚙️ 件数 / 閾値 (7段パイプラインのスコアリング基準)
        </summary>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberRow
            label="Stage1: Gemini #1 KW候補生成数"
            placeholder={String(DEFAULTS.kwCandidateCount)}
            value={config.kwCandidateCount}
            onChange={(v) => setConfig({ ...config, kwCandidateCount: v })}
            hint="通常 100件 / Backlinks契約後は最大500件まで網羅可"
          />
          <NumberRow
            label="Stage2.5: KD 上限 (Backlinks 契約必須)"
            placeholder={String(DEFAULTS.maxKd)}
            value={config.maxKd}
            onChange={(v) => setConfig({ ...config, maxKd: v })}
            hint="KDがこの値を超えるKWを機械的に除外 (推奨: 30=個人ブログで戦える上限)"
          />
          <NumberRow
            label="Stage3: SV 最低値 (月間検索数)"
            placeholder={String(DEFAULTS.minSv)}
            value={config.minSv}
            onChange={(v) => setConfig({ ...config, minSv: v })}
            hint="これ以下のKWはCV見込薄として除外 (推奨: 100)"
          />
          <NumberRow
            label="Stage3: CPC 最低値 (円)"
            placeholder={String(Math.round(DEFAULTS.minCpc * 150))}
            value={
              config.minCpc !== undefined
                ? Math.round(config.minCpc * 150)
                : undefined
            }
            onChange={(v) =>
              setConfig({
                ...config,
                // 入力は円、内部は USD (DataForSEO が USD で返すため) → /150 で USD に換算
                minCpc: v === undefined ? undefined : Math.round(v) / 150,
              })
            }
            hint="広告出稿価値の低いKWを除外 (推奨: 30円)"
          />
          <NumberRow
            label="最終判定に回すKW上限"
            placeholder={String(DEFAULTS.maxFinalCount)}
            value={config.maxFinalCount}
            onChange={(v) => setConfig({ ...config, maxFinalCount: v })}
            hint="SERP Advanced を叩く件数 (推奨: 10)"
          />
        </div>
      </details>

      {/* 除外KW */}
      <details className="rounded-xl border border-[var(--border-subtle)] bg-white" open>
        <summary className="cursor-pointer px-4 py-3 font-semibold text-[13px]">
          🚫 除外KW (1行に1KW、空行可)
        </summary>
        <div className="px-4 pb-4">
          <textarea
            value={excludeText}
            onChange={(e) => setExcludeText(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full text-[13px] font-mono px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white"
            placeholder={"商品名 偽物\n無料\n競合の商標"}
          />
          <p className="text-[10px] text-[color:var(--fg-muted)] mt-1">
            ここに書いたKWは Gemini #1 の出力からも、Stage1 後のフィルタでも除外されます。
          </p>
        </div>
      </details>

      {/* Gemini プロンプト3段 */}
      <details className="rounded-xl border border-[var(--border-subtle)] bg-white">
        <summary className="cursor-pointer px-4 py-3 font-semibold text-[13px]">
          🤖 Gemini プロンプト 3段 (上級者向け / 空欄ならデフォルト使用)
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="text-[11px] text-[color:var(--fg-secondary)] leading-relaxed p-3 rounded-lg bg-[color:var(--accent-soft)]/40 border border-[color:var(--accent)]/20">
            <p className="font-semibold mb-1">💡 使い方</p>
            <p>
              各段で <code className="font-mono px-1 rounded bg-white text-[color:var(--accent-dark)]">{"{subject}"}</code> 等の
              placeholder を埋め込めます。実行時に自動で値が入ります。
              空欄ならデフォルトプロンプトが使用されます。
            </p>
            <p className="mt-2 font-semibold">使える placeholder:</p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside">
              <li><strong>Stage1</strong>: <code className="font-mono">{"{subject}"}</code> / <code className="font-mono">{"{maxKeywords}"}</code> / <code className="font-mono">{"{excludeKws}"}</code></li>
              <li><strong>Stage3</strong>: <code className="font-mono">{"{subject}"}</code> / <code className="font-mono">{"{category}"}</code> / <code className="font-mono">{"{keywords}"}</code> / <code className="font-mono">{"{minSv}"}</code> / <code className="font-mono">{"{minCpc}"}</code> / <code className="font-mono">{"{maxFinalCount}"}</code></li>
              <li><strong>Stage5</strong>: <code className="font-mono">{"{subject}"}</code> / <code className="font-mono">{"{candidates}"}</code></li>
            </ul>
            <p className="mt-2 text-[10px] text-[color:var(--fg-muted)]">
              ※ 出力フォーマット (JSON) の指示は自動で末尾に付加されます。
            </p>
          </div>
          <PromptArea
            label="Stage1: KW候補生成プロンプト (Gemini #1)"
            value={config.promptKwGen ?? ""}
            onChange={(v) => setConfig({ ...config, promptKwGen: v })}
          />
          <PromptArea
            label="Stage3: 数値+重複排除の1次絞り込み (Gemini #2)"
            value={config.promptStage3 ?? ""}
            onChange={(v) => setConfig({ ...config, promptStage3: v })}
          />
          <PromptArea
            label="Stage5: SERP込みの最終判定 (Gemini #3)"
            value={config.promptFinal ?? ""}
            onChange={(v) => setConfig({ ...config, promptFinal: v })}
          />
        </div>
      </details>

      {/* 保存 */}
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

function NumberRow(props: {
  label: string;
  placeholder: string;
  value?: number;
  onChange: (v: number | undefined) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-[color:var(--fg-secondary)]">{props.label}</span>
      <input
        type="number"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        step={props.step ?? "1"}
        onChange={(e) => {
          const v = e.target.value;
          props.onChange(v === "" ? undefined : Number(v));
        }}
        className="w-full mt-1 text-[13px] px-3 py-1.5 rounded-lg border border-[var(--border-card)] bg-white"
      />
      {props.hint && (
        <span className="text-[10px] text-[color:var(--fg-muted)] block mt-0.5">{props.hint}</span>
      )}
    </label>
  );
}

function PromptArea(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-[color:var(--fg-secondary)]">{props.label}</span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full mt-1 text-[12px] font-mono leading-[1.6] px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white"
        placeholder="空欄ならデフォルトプロンプト使用"
      />
    </label>
  );
}
