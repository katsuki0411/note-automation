"use client";

// 共通ローディング表示。サイズ・メッセージを切替可能。
// note ロゴ（'n' マーク）を流用し、ふわっと浮遊するアニメで統一感を出す。
// 設計は ad-manager の Loading コンポーネントを踏襲しつつ、配色を note のミントグリーンに調整。

import { NoteLogoMark } from "./NoteLogo";

type Props = {
  size?: "sm" | "md" | "lg";
  message?: string;
  fill?: boolean;
};

export default function Loading({ size = "md", message = "読み込み中…", fill = true }: Props) {
  const dotSize = size === "sm" ? "w-1 h-1" : size === "md" ? "w-1.5 h-1.5" : "w-2 h-2";
  const iconWrap =
    size === "sm" ? "w-7 h-7 rounded-lg" : size === "md" ? "w-10 h-10 rounded-xl" : "w-14 h-14 rounded-2xl";
  const logoSize = size === "sm" ? 18 : size === "md" ? 28 : 40;
  const textSize = size === "sm" ? "text-[10px]" : size === "md" ? "text-xs" : "text-sm";
  const gap = size === "sm" ? "gap-2" : size === "md" ? "gap-3" : "gap-4";
  const padding = size === "sm" ? "py-3" : size === "md" ? "py-8" : "py-12";

  return (
    <div
      className={`flex flex-col items-center justify-center ${gap} ${
        fill ? "h-full w-full" : padding
      } bg-gradient-to-br from-[color:var(--accent-soft)]/40 via-white to-[color:var(--accent-soft)]/40`}
    >
      <div className="relative">
        {/* 外周のglow */}
        <div
          className={`absolute inset-0 ${iconWrap} bg-[color:var(--accent)]/30 blur-md animate-pulse`}
        />
        {/* ロゴ本体（軽くフロート） */}
        <div
          className={`relative ${iconWrap} bg-white ring-1 ring-[color:var(--accent)]/30 flex items-center justify-center shadow-lg shadow-[color:var(--accent)]/20 animate-[note-loading-float_2.4s_ease-in-out_infinite]`}
        >
          <NoteLogoMark size={logoSize} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={`${dotSize} rounded-full bg-[color:var(--accent)] animate-bounce`}
          style={{ animationDelay: "0ms" }}
        />
        <span
          className={`${dotSize} rounded-full bg-[color:var(--accent)] animate-bounce`}
          style={{ animationDelay: "150ms" }}
        />
        <span
          className={`${dotSize} rounded-full bg-[color:var(--accent)] animate-bounce`}
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <p className={`${textSize} text-[color:var(--accent-dark)] font-medium tracking-wide`}>
        {message}
      </p>

      <style>{`
        @keyframes note-loading-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
}

/** ボタン等のインラインスピナー */
export function InlineSpinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-1 h-1 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}
