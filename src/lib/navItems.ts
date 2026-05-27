// サイドバーとPageHeaderで共有するナビゲーション定義。
// kind (research_based / amazon_affiliate / a8_affiliate) によって項目が変わる。

import type { ComponentType } from "react";
import {
  SparklesIcon,
  LibraryIcon,
  PostedIcon,
  SeoIcon,
  SettingsIcon,
  ProductScoutIcon,
} from "@/components/NavIcons";
import type { ProjectKind } from "@/lib/projects-types";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: IconComponent;
};

// 共通: 全 kind で表示する項目 (research_based のデフォルトでもある)
const COMMON_ITEMS: NavItem[] = [
  { href: "/", label: "ネタ収集 ＆ 生成", desc: "Research & Generate", icon: SparklesIcon },
  { href: "/library", label: "ライブラリ", desc: "Library", icon: LibraryIcon },
  { href: "/posted", label: "投稿レコード", desc: "Post Records", icon: PostedIcon },
  { href: "/seo", label: "SEO順位", desc: "SEO Rank", icon: SeoIcon },
  { href: "/settings", label: "設定", desc: "Settings", icon: SettingsIcon },
];

// アフィ系限定: 商品スカウト (Brave で関連KW競合判定)
const PRODUCT_SCOUT_ITEM: NavItem = {
  href: "/products",
  label: "商品スカウト",
  desc: "Product Scout",
  icon: ProductScoutIcon,
};

// kind 別のナビ項目を返す
export function getNavItemsForKind(kind: ProjectKind): NavItem[] {
  switch (kind) {
    case "amazon_affiliate":
    case "a8_affiliate":
      // 商品スカウトを「ネタ収集」の次に挿入
      return [COMMON_ITEMS[0], PRODUCT_SCOUT_ITEM, ...COMMON_ITEMS.slice(1)];
    case "research_based":
    default:
      return COMMON_ITEMS;
  }
}

// 後方互換: 既存コード用 (kind 不明時のフォールバック)。新規コードは getNavItemsForKind を使うこと。
export const NAV_ITEMS: NavItem[] = COMMON_ITEMS;

/** pathname から該当する NavItem を返す（PageHeader のアイコン表示用） */
export function findNavItemByPath(pathname: string): NavItem | undefined {
  // 全 kind の全項目を統合してから検索
  const all = [...COMMON_ITEMS, PRODUCT_SCOUT_ITEM];
  const exact = all.find((i) => i.href === pathname);
  if (exact) return exact;
  return all.find((i) => i.href !== "/" && pathname.startsWith(i.href));
}
