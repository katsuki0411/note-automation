type Props = { size?: number; className?: string };

export function NoteLogoMark({ size = 32, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="note logo"
    >
      <rect width="64" height="64" rx="14" fill="#1a1a1a" />
      <path
        d="M19 18 v28 h7 v-15 c0-3.5 2-5.5 5-5.5 c3 0 5 2 5 5.5 v15 h7 v-17 c0-7-4-11-10-11 c-3 0-5.5 1.2-7 3 v-3 z"
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
        note <span className="text-[color:var(--accent-dark)]">automation</span>
      </span>
    </span>
  );
}
