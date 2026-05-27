// 旧名は "note automation"。MultiPostAI にリブランド (2026-05-27)。
// コンポーネント名 NoteLogo* は import 互換性のため維持。

type Props = { size?: number; className?: string };

export function NoteLogoMark({ size = 32, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="MultiPostAI logo"
    >
      <rect width="64" height="64" rx="14" fill="#1a1a1a" />
      {/* M を中心に配置 (MultiPost の頭文字)。横幅28を viewBox(64) の中央 18〜46 に */}
      <path
        d="M18 46 V18 h6 l8 14 l8 -14 h6 V46 h-6 V28 l-6 10 h-4 l-6 -10 V46 z"
        fill="#41c9b4"
      />
    </svg>
  );
}

export function NoteLogoFull({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <NoteLogoMark size={30} />
      <span className="note-logo-text text-[18px] text-[color:var(--fg-primary)]">
        MultiPost<span className="text-[color:var(--accent-dark)]">AI</span>
      </span>
    </span>
  );
}
