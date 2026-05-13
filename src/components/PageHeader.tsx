type Props = {
  step: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
};

// スクロール時もタイトルが見えるよう sticky にしている。
// 親 (<main>) の px-4 / md:px-8 を打ち消すために負のマージンで全幅に展開し、
// 半透明白 + backdrop blur で下のコンテンツがほのかに透ける。
export default function PageHeader({ step, title, description, right }: Props) {
  return (
    <div className="sticky top-[56px] md:top-0 z-20 -mx-4 md:-mx-8 -mt-6 md:-mt-10 px-4 md:px-8 py-3 md:py-4 mb-6 md:mb-8 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b border-[var(--border-subtle)]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-6">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
            <span className="text-[10px] md:text-[11px] font-mono tracking-[0.25em] text-[color:var(--accent-dark)]">
              {step}
            </span>
          </div>
          <h1 className="text-[20px] md:text-[26px] font-bold tracking-tight text-[color:var(--fg-primary)] leading-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-[12px] md:text-[13px] text-[color:var(--fg-secondary)] line-clamp-1 md:line-clamp-none">
              {description}
            </p>
          )}
        </div>
        {right && (
          <div className="flex items-center gap-2 md:gap-2.5 flex-wrap shrink-0">{right}</div>
        )}
      </div>
    </div>
  );
}
