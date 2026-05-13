"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  ARTICLE_MODEL_OPTIONS,
  DEFAULT_ARTICLE_MODEL,
  readArticleModel,
  writeArticleModel,
  readArticleUrls,
  writeArticleUrls,
  type ArticleModel,
  type ArticleUrl,
} from "@/lib/clientSettings";

export default function SettingsPage() {
  const [model, setModel] = useState<ArticleModel>(DEFAULT_ARTICLE_MODEL);
  const [savedModel, setSavedModel] = useState<ArticleModel>(DEFAULT_ARTICLE_MODEL);
  const [mounted, setMounted] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const [articleUrls, setArticleUrls] = useState<ArticleUrl[]>([]);
  const [newUrlLabel, setNewUrlLabel] = useState("");
  const [newUrlPrefix, setNewUrlPrefix] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readArticleModel();
    setModel(stored);
    setSavedModel(stored);
    setArticleUrls(readArticleUrls());
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

  const persistUrls = (next: ArticleUrl[]) => {
    setArticleUrls(next);
    writeArticleUrls(next);
  };

  const addArticleUrl = () => {
    const label = newUrlLabel.trim();
    const prefix = newUrlPrefix.trim();
    setUrlError(null);
    if (!label || !prefix) {
      setUrlError("ラベルとURLの両方を入力してください");
      return;
    }
    if (!/^https?:\/\//i.test(prefix)) {
      setUrlError("URLは http:// または https:// で始めてください");
      return;
    }
    if (articleUrls.some((u) => u.urlPrefix === prefix)) {
      setUrlError("同じURLが既に登録されています");
      return;
    }
    const next: ArticleUrl[] = [
      ...articleUrls,
      { id: crypto.randomUUID(), label, urlPrefix: prefix },
    ];
    persistUrls(next);
    setNewUrlLabel("");
    setNewUrlPrefix("");
  };

  const removeArticleUrl = (id: string) => {
    if (!confirm("このURLを削除しますか？")) return;
    persistUrls(articleUrls.filter((u) => u.id !== id));
  };

  return (
    <>
      <PageHeader
        title="設定"
        description="記事生成モデルと、SEO順位チェック用の記事URLを管理します。"
      />

      <div className="max-w-2xl">
      <section className="space-y-4">
        <div>
          <h2 className="section-title mb-1">記事生成モデル</h2>
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
      </section>

      <section className="space-y-4 mt-12 pt-8 border-t border-[var(--border-subtle)]">
        <div>
          <h2 className="section-title mb-1">自分の記事URL</h2>
          <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
            SEO順位チェックで「自分の記事」と判定するためのURLを登録します。
            登録したURLは <span className="font-mono">/seo</span> の追加フォームでプルダウンから選べます。
          </p>
        </div>

        {mounted && articleUrls.length > 0 && (
          <ul className="space-y-2">
            {articleUrls.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-subtle)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[color:var(--fg-primary)] truncate">
                    {u.label}
                  </div>
                  <div className="text-[11px] font-mono text-[color:var(--fg-muted)] truncate">
                    {u.urlPrefix}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeArticleUrl(u.id)}
                  className="text-[12px] text-red-500 hover:text-red-700 shrink-0"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 p-4 rounded-lg border border-dashed border-[var(--border-card)]">
          <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)]">
            NEW URL
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <input
              value={newUrlLabel}
              onChange={(e) => setNewUrlLabel(e.target.value)}
              placeholder="ラベル（例: メインアカウント）"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)]"
            />
            <input
              value={newUrlPrefix}
              onChange={(e) => setNewUrlPrefix(e.target.value)}
              placeholder="https://note.com/your_username/"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-[13px] focus:outline-none focus:border-[color:var(--accent)] font-mono"
            />
          </div>
          {urlError && (
            <p className="text-[11px] text-red-600">{urlError}</p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addArticleUrl}
              disabled={!newUrlLabel.trim() || !newUrlPrefix.trim()}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              + 追加
            </button>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
