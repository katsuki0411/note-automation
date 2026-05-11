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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setModel(readArticleModel());
    setMounted(true);
  }, []);

  const handleChange = (value: ArticleModel) => {
    setModel(value);
    writeArticleModel(value);
  };

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
            記事本文の生成に使うAIモデルを選択します。設定はこのブラウザにのみ保存され、選択した時点で即時反映されます。
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

        {mounted && (
          <p className="text-[12px] text-[color:var(--fg-muted)]">
            現在の選択:{" "}
            <span className="font-mono text-[color:var(--fg-secondary)]">{model}</span>
          </p>
        )}
      </section>
    </div>
  );
}
