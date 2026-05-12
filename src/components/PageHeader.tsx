type Props = {
  step: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
};

export default function PageHeader({ step, title, description, right }: Props) {
  return (
    <div className="mb-6 md:mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-6">
      <div>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
          <span className="text-[11px] font-mono tracking-[0.25em] text-[color:var(--accent-dark)]">
            {step}
          </span>
        </div>
        <h1 className="text-[22px] md:text-[30px] font-bold tracking-tight text-[color:var(--fg-primary)]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-[13px] md:text-[14px] text-[color:var(--fg-secondary)]">
            {description}
          </p>
        )}
      </div>
      {right && (
        <div className="flex items-center gap-2 md:gap-2.5 flex-wrap">{right}</div>
      )}
    </div>
  );
}
