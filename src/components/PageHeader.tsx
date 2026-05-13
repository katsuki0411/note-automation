"use client";

import { usePathname } from "next/navigation";
import { findNavItemByPath } from "@/lib/navItems";

type Props = {
  title: string;
  description?: string;
  right?: React.ReactNode;
};

// スクロール時もタイトルが見えるよう sticky にしている。
// アイコンは pathname から自動解決（サイドバーと同じアイコンが出る）。
// 親 (<main>) の px-4 / md:px-8 / py-6/10 を打ち消すために負のマージンで全幅展開、
// 半透明白 + backdrop blur で下のコンテンツがほのかに透ける。
export default function PageHeader({ title, description, right }: Props) {
  const pathname = usePathname();
  const nav = findNavItemByPath(pathname ?? "/");
  const Icon = nav?.icon;

  return (
    <div className="sticky top-[56px] md:top-0 z-20 -mx-4 md:-mx-8 -mt-6 md:-mt-10 px-4 md:px-8 py-3 md:py-4 mb-6 md:mb-8 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b border-[var(--border-subtle)]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-6">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          {Icon && (
            <span className="shrink-0 flex items-center justify-center w-9 h-9 md:w-11 md:h-11 rounded-xl bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] ring-1 ring-[color:var(--accent)]/30">
              <Icon size={22} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-[20px] md:text-[26px] font-bold tracking-tight text-[color:var(--fg-primary)] leading-tight">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-[12px] md:text-[13px] text-[color:var(--fg-secondary)] line-clamp-1 md:line-clamp-none">
                {description}
              </p>
            )}
          </div>
        </div>
        {right && (
          <div className="flex items-center gap-2 md:gap-2.5 flex-wrap shrink-0">{right}</div>
        )}
      </div>
    </div>
  );
}
