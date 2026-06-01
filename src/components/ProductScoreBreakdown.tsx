"use client";

import { useState } from "react";
import type { ScoreBreakdown } from "@/lib/productScoring";

const GRADE_STYLE: Record<ScoreBreakdown["grade"], { emoji: string; cls: string }> = {
  S: { emoji: "🥇", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  A: { emoji: "🥈", cls: "bg-gray-100 text-gray-700 border-gray-300" },
  B: { emoji: "🥉", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  C: { emoji: "📊", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  D: { emoji: "🔻", cls: "bg-red-50 text-red-700 border-red-200" },
};

type Props = {
  breakdown: ScoreBreakdown;
  compact?: boolean; // true = リスト用の小バッジ / false = 詳細表示
};

/**
 * 収益化スコアのバッジ + クリックで展開する内訳プルダウン。
 * 内訳には各要素の式 / 計算結果 / 重みを表示。
 */
export default function ProductScoreBreakdown({ breakdown, compact = true }: Props) {
  const [open, setOpen] = useState(!compact);
  const style = GRADE_STYLE[breakdown.grade];

  return (
    <div className="inline-block relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold whitespace-nowrap ${style.cls} hover:opacity-80 transition-opacity`}
        title="クリックでスコア内訳を表示"
      >
        <span>{style.emoji}</span>
        <span>{breakdown.grade}</span>
        <span className="font-mono">{breakdown.total}</span>
        <span className="text-[9px] opacity-60">▾</span>
      </button>

      {open && (
        <div
          className="absolute z-20 top-full left-0 mt-1 w-[280px] bg-white border border-[var(--border-card)] rounded-lg shadow-lg p-3 text-[11px] space-y-2"
          onMouseLeave={() => compact && setOpen(false)}
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
            <div className="font-semibold text-[12px] text-[color:var(--fg-primary)]">
              収益化スコア内訳
            </div>
            <div className={`text-[10px] px-1.5 py-0.5 rounded ${style.cls}`}>
              {style.emoji} {breakdown.grade}ランク
            </div>
          </div>

          <ul className="space-y-1.5">
            {breakdown.factors.map((f) => (
              <li key={f.label} className="leading-snug">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[color:var(--fg-secondary)] font-semibold">
                    {f.label}
                  </span>
                  <span className="text-[9px] text-[color:var(--fg-muted)]">
                    重み {Math.round(f.weight * 100)}%
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[color:var(--fg-muted)] truncate">
                  {f.formula}
                </div>
                <div className="text-[color:var(--fg-primary)] font-mono text-[11px]">
                  = {f.display}
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t border-gray-100 pt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-[color:var(--fg-muted)]">合計</span>
            <span className="font-mono font-bold text-[14px] text-[color:var(--fg-primary)]">
              {breakdown.total}
              <span className="text-[9px] text-[color:var(--fg-muted)] ml-0.5">/100</span>
            </span>
          </div>

          {breakdown.notes.length > 0 && (
            <div className="border-t border-gray-100 pt-1.5 space-y-0.5">
              {breakdown.notes.map((n, i) => (
                <div key={i} className="text-[9px] text-orange-700">
                  ℹ {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
