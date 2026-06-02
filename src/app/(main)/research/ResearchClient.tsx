"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";
import BestsellersClient from "../bestsellers/BestsellersClient";

// タブ定義
// label: 表示名 / desc: 説明 / impl: 実装済みか / paApiRequired: PA-API必須か
type TabDef = {
  id: TabId;
  emoji: string;
  label: string;
  desc: string;
  impl: boolean;
  paApiRequired: boolean;
  future?: string; // 未実装の場合の予告文
};

type TabId = "bestseller" | "topsell" | "new" | "deal" | "highly_rated" | "search";

const TABS: TabDef[] = [
  {
    id: "bestseller",
    emoji: "🔥",
    label: "ベストセラー",
    desc: "Amazon カテゴリ別 TOP10。スクレイピングで取得",
    impl: true,
    paApiRequired: false,
  },
  {
    id: "topsell",
    emoji: "📈",
    label: "売れ筋ランキング",
    desc: "TOP10 以外の隠れヒット (上位100位まで深掘り)",
    impl: false,
    paApiRequired: true,
    future:
      "PA-API の SearchItemsByBrowseNode で各カテゴリの売れ筋ランクを上位100位まで取得。レビュー数・★評価込みで、ベストセラー TOP10 以外の「2軍商品」を発掘。",
  },
  {
    id: "new",
    emoji: "🆕",
    label: "新着商品",
    desc: "過去30日に発売された商品。競合が少ない先行記事チャンス",
    impl: false,
    paApiRequired: true,
    future:
      "PA-API の SearchItems で BrowseNodes=newReleases を指定。発売直後の商品は SEO 競合がまだ少なく、先行記事を出せれば独占しやすい。",
  },
  {
    id: "deal",
    emoji: "💰",
    label: "セール・値下げ",
    desc: "タイムセール / プライムデー対象商品",
    impl: false,
    paApiRequired: true,
    future:
      "PA-API の Offers > Promotions でセール対象商品を抽出。プライムデー / 母の日 / ブラックフライデー等の短期集中型のネタに使う。",
  },
  {
    id: "highly_rated",
    emoji: "⭐",
    label: "高評価商品",
    desc: "★4以上 & レビュー多数の支持商品",
    impl: false,
    paApiRequired: true,
    future:
      "PA-API の SearchItems で MinReviewsRating=4 & MinPrice 等のフィルタ。安定して売れている商品ばかりなので、長期的に PV を稼ぐ記事向け。",
  },
  {
    id: "search",
    emoji: "🔍",
    label: "キーワード検索",
    desc: "任意キーワードで Amazon 商品検索",
    impl: false,
    paApiRequired: true,
    future:
      "PA-API の SearchItems で Keywords=自由入力。記事化したいテーマ起点 (例: 寝るとき イヤホン) で商品を探す。価格帯・カテゴリ・★評価でフィルタ。",
  },
];

export default function ResearchClient() {
  const [activeTab, setActiveTab] = useState<TabId>("bestseller");
  const activeTabDef = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <>
      <PageHeader title="商品リサーチ">
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px overflow-x-auto">
            {TABS.map((t) => (
              <GroupTab
                key={t.id}
                active={t.id === activeTab}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="mr-1">{t.emoji}</span>
                {t.label}
                {!t.impl && (
                  <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 align-middle">
                    準備中
                  </span>
                )}
              </GroupTab>
            ))}
          </div>
        </FilterBar>
      </PageHeader>

      <div className="max-w-5xl space-y-5">
        {/* タブ説明 */}
        <div className="text-[12px] text-[color:var(--fg-muted)] leading-snug">
          {activeTabDef.desc}
        </div>

        {/* タブ本体 */}
        <div>
          {activeTab === "bestseller" ? (
            <BestsellersClient />
          ) : (
            <PlaceholderPane tab={activeTabDef} />
          )}
        </div>
      </div>
    </>
  );
}

function PlaceholderPane({ tab }: { tab: TabDef }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-card)] bg-gray-50/50 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[28px]">{tab.emoji}</span>
        <div>
          <h3 className="text-[15px] font-semibold text-[color:var(--fg-primary)]">
            {tab.label}
          </h3>
          {tab.paApiRequired && (
            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
              PA-API 取得後に有効化
            </span>
          )}
        </div>
      </div>

      {tab.future && (
        <div className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed bg-white border border-[var(--border-subtle)] rounded p-3">
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1.5">
            予定の機能
          </div>
          {tab.future}
        </div>
      )}

      <div className="text-[11px] text-[color:var(--fg-muted)] leading-relaxed">
        💡 Amazon アソシエイト本承認 + PA-API キー発行後に実データで動き出します。
        申請手順は{" "}
        <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">
          web/docs/AMAZON_ASSOCIATE_SETUP.md
        </code>{" "}
        参照。
      </div>
    </div>
  );
}
