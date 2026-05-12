"use client";

import { useEffect, useState } from "react";
import {
  ARTICLE_MODEL_OPTIONS,
  DEFAULT_ARTICLE_MODEL,
  readArticleModel,
  writeArticleModel,
  type ArticleModel,
} from "@/lib/clientSettings";

export default function SettingsPage() {
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
    <div className="max-w-2xl">
      <header className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--fg-muted)] mb-2">
          Settings
        </div>
        <h1 className="text-2xl font-semibold text-[color:var(--fg-primary)]">設定</h1>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--fg-primary)] mb-1">
            記事生成モデル
          </h2>
          <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
            記事本文の生成に使うAIモデルを選択します。設定はこのブラウザにのみ保存されます。
          </p>
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
            className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
              hasUnsaved
                ? "bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent-dark)]"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
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
      </section>
    </div>
  );
}
