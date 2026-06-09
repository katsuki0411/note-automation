"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";
import DestinationsTab from "./DestinationsTab";
import IntegrationsTab from "./IntegrationsTab";
import AccountsTab from "./AccountsTab";
// ScoutConfigTab は 2026-06-09 に KWスカウト 配下の「スカウト設定」タブに移動した
// (シェアコンポーネントとして ProductsClient.tsx から import される)
// ArticleGenConfigTab は 2026-06-09 にライブラリ配下の「記事生成プロンプト」タブに移動した
import {
  ARTICLE_MODEL_OPTIONS,
  DEFAULT_ARTICLE_MODEL,
  readArticleModel,
  writeArticleModel,
  type ArticleModel,
} from "@/lib/clientSettings";

// 「自分の記事URL」タブは 2026-06-02 廃止。各 destination の編集フォーム内
// 「自分の記事URL (任意)」欄に統合した (DestinationsTab 参照)。
type Tab = "destinations" | "model" | "integrations" | "accounts";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("destinations");

  const [model, setModel] = useState<ArticleModel>(DEFAULT_ARTICLE_MODEL);
  const [savedModel, setSavedModel] = useState<ArticleModel>(DEFAULT_ARTICLE_MODEL);
  const [mounted, setMounted] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const stored = readArticleModel();
    setModel(stored);
    setSavedModel(stored);
    setMounted(true);
  }, []);

  const handleChange = (value: ArticleModel) => {
    setModel(value);
    setJustSaved(false);
  };

  const handleSave = () => {
    writeArticleModel(model);
    setSavedModel(model);
    setJustSaved(true);
  };

  const hasUnsaved = mounted && model !== savedModel;

  return (
    <>
      <PageHeader title="設定">
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px overflow-x-auto">
            <GroupTab active={tab === "destinations"} onClick={() => setTab("destinations")}>
              投稿先
            </GroupTab>
            <GroupTab active={tab === "model"} onClick={() => setTab("model")}>
              記事生成モデル
            </GroupTab>
            <GroupTab active={tab === "integrations"} onClick={() => setTab("integrations")}>
              API連携
            </GroupTab>
            <GroupTab active={tab === "accounts"} onClick={() => setTab("accounts")}>
              アカウント
            </GroupTab>
          </div>
        </FilterBar>
      </PageHeader>

      {tab === "destinations" && <DestinationsTab />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "accounts" && <AccountsTab />}

      {tab === "model" && (
        <div className="max-w-2xl space-y-4">
          <div>
            <h2 className="section-title">記事生成モデル</h2>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="記事生成モデル">
            {ARTICLE_MODEL_OPTIONS.map((opt) => {
              const checked = mounted && model === opt.id;
              return (
                <label
                  key={opt.id}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    checked
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                      : "border-[var(--border-subtle)] hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="articleModel"
                    value={opt.id}
                    checked={checked}
                    onChange={() => handleChange(opt.id)}
                    className="mt-1 accent-[color:var(--accent)]"
                  />
                  <span className="flex-1">
                    <span className="block text-[14px] font-semibold text-[color:var(--fg-primary)]">
                      {opt.label}
                    </span>
                    <span className="block text-[12px] text-[color:var(--fg-secondary)] mt-0.5">
                      {opt.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasUnsaved}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              保存
            </button>
            {mounted && hasUnsaved && (
              <span className="text-[12px] text-[color:var(--fg-muted)]">未保存の変更があります</span>
            )}
            {mounted && !hasUnsaved && justSaved && (
              <span className="text-[12px] text-[color:var(--accent-dark)]">保存しました</span>
            )}
            {mounted && !hasUnsaved && !justSaved && (
              <span className="text-[12px] text-[color:var(--fg-muted)]">
                現在の選択: <span className="font-mono">{savedModel}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
