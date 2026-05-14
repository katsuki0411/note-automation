"use client";

// PageHeader の children として使う「タブ + フィルター + ソート」のレイアウト。
// sticky 配置や bg/border は PageHeader 側がまとめて持つので、こちらはレイアウトだけ。
// PageHeader と1つの sticky コンテナに入ることで、スクロール時に「片方だけ少し動く」現象を回避。

import type { ReactNode } from "react";

type Props = { children: ReactNode };

export function FilterBar({ children }: Props) {
  return (
    <div className="py-3 md:py-3.5 space-y-2.5 border-t border-[var(--border-subtle)]">
      {children}
    </div>
  );
}

/** 下線つきタブ (テーマ別 / 公式サイト別 / キーワード別 ...) */
export function GroupTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition ${
        active
          ? "border-[color:var(--accent)] text-[color:var(--fg-primary)]"
          : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}

/** 丸ピル (フィルター / ソート 兼用 / 「すべて」「新着1h」など)
 *  Linear / Stripe Dashboard 風 — 縁線なし、bg のみで差別化 */
export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all ${
        active
          ? "bg-[color:var(--fg-primary)] text-white shadow-sm shadow-black/10"
          : "bg-gray-50 text-[color:var(--fg-secondary)] hover:bg-gray-100 hover:text-[color:var(--fg-primary)]"
      }`}
    >
      {children}
    </button>
  );
}
