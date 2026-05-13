// サイドバーとPageHeaderで共有するナビゲーション定義。
// ここを編集すれば両方に反映される。

import type { ComponentType } from "react";
import {
  SparklesIcon,
  LibraryIcon,
  KeywordsIcon,
  SourcesIcon,
  SeoIcon,
  SettingsIcon,
} from "@/components/NavIcons";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: IconComponent;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "ネタ収集 ＆ 生成", desc: "Research & Generate", icon: SparklesIcon },
  { href: "/library", label: "ライブラリ", desc: "Library", icon: LibraryIcon },
  { href: "/keywords", label: "キーワード戦略", desc: "Keywords", icon: KeywordsIcon },
  { href: "/platforms", label: "情報源", desc: "Sources", icon: SourcesIcon },
  { href: "/seo", label: "SEO順位", desc: "SEO Rank", icon: SeoIcon },
  { href: "/settings", label: "設定", desc: "Settings", icon: SettingsIcon },
];

/** pathname から該当する NavItem を返す（PageHeader のアイコン表示用） */
export function findNavItemByPath(pathname: string): NavItem | undefined {
  // 完全一致を優先、無ければ前方一致（"/" 以外）
  const exact = NAV_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact;
  return NAV_ITEMS.find((i) => i.href !== "/" && pathname.startsWith(i.href));
}
