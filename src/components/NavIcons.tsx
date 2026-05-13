// サイドバーとPageHeaderで共有するアイコンセット。
// 外部アイコンライブラリを入れずに済むよう、ライン系の simple SVG で揃える。
// 全アイコン同一の viewBox 24x24 / stroke 1.75 で見た目を統一。

type IconProps = { size?: number; className?: string };

const baseProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** ネタ収集 & 生成 - sparkles（ひらめき・生成） */
export function SparklesIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="M12 7l1.5 3.5L17 12l-3.5 1.5L12 17l-1.5-3.5L7 12l3.5-1.5L12 7z" />
    </svg>
  );
}

/** ライブラリ - 本の重ね */
export function LibraryIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <path d="M4 4h6v16H4z" />
      <path d="M10 4h6v16h-6z" />
      <path d="M16 6l4 .8-2.5 14.7-4-.8" />
    </svg>
  );
}

/** キーワード戦略 - hash */
export function KeywordsIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </svg>
  );
}

/** 情報源 - 地球（ソース） */
export function SourcesIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 010 18a14 14 0 010-18" />
    </svg>
  );
}

/** SEO順位 - 上昇するトレンドライン */
export function SeoIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

/** 設定 - 歯車 */
export function SettingsIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
