"use client";

// PageHeader 直下に置く sticky なタブ + フィルター + ソートのコンテナ。
// 各ページで共有してデザイン統一する。
// PageHeader の mb-6/md:mb-8 を打ち消す負のマージン (-mt-6 md:-mt-8) で
// 初期状態からタイトル直下にピッタリ並ぶ。スクロールしても同じ見た目を維持。

import type { ReactNode } from "react";

type Props = { children: ReactNode };

export function FilterBar({ children }: Props) {
  return (
    <div className="card sticky top-[120px] md:top-[84px] z-10 p-4 mb-5 -mt-6 md:-mt-8 space-y-3 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
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

/** 丸ピル (フィルター / ソート 兼用 / 「すべて」「新着1h」など) */
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
      className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition ${
        active
          ? "bg-[color:var(--black)] text-white"
          : "bg-white border border-[var(--border-card)] text-[color:var(--fg-secondary)] hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}
