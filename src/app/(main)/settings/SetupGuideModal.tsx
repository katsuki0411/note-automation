"use client";

import { useEffect } from "react";
import { PLATFORM_GUIDES, type SetupGuide } from "@/lib/posters/setupGuides";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";

export default function SetupGuideModal({
  platform,
  onClose,
}: {
  platform: Platform;
  onClose: () => void;
}) {
  const guide: SetupGuide | undefined = PLATFORM_GUIDES[platform];
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;

  // ESC で閉じる
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!guide) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl max-w-md w-full p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[13px] text-[color:var(--fg-secondary)]">
            {platformLabel} の取得手順は未整備です。
          </p>
          <button type="button" onClick={onClose} className="btn-ghost mt-3">
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-3 bg-gradient-to-r from-[color:var(--accent-soft)] to-white">
          <div className="min-w-0">
            <div className="text-[10px] font-mono tracking-widest text-[color:var(--accent-dark)] mb-1">
              SETUP GUIDE
            </div>
            <h2 className="text-[18px] font-bold text-[color:var(--fg-primary)]">
              {platformLabel} の接続情報の取り方
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] shrink-0"
          >
            ✕ 閉じる
          </button>
        </div>

        {/* 本文 (スクロール) */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {guide.intro && (
            <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
              {guide.intro}
            </p>
          )}

          {guide.caveats && guide.caveats.length > 0 && (
            <div className="rounded-lg bg-orange-50 border border-orange-100 p-3 space-y-1">
              {guide.caveats.map((c, i) => (
                <div key={i} className="text-[11px] text-orange-800 leading-snug">
                  ⚠ {c}
                </div>
              ))}
            </div>
          )}

          {/* ステップ縦並べ */}
          <ol className="space-y-3">
            {guide.steps.map((step, i) => (
              <li
                key={i}
                className="relative rounded-lg border border-[var(--border-subtle)] p-4 bg-white hover:border-[color:var(--accent)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-[color:var(--accent)] text-white text-[12px] font-bold">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                      {step.title}
                    </div>
                    <p className="text-[12px] text-[color:var(--fg-secondary)] mt-1 leading-relaxed">
                      {step.body}
                    </p>
                    {step.codeSnippet && (
                      <pre className="mt-2 p-2.5 rounded bg-gray-900 text-green-300 text-[11px] font-mono overflow-x-auto whitespace-pre">
                        {step.codeSnippet}
                      </pre>
                    )}
                    {step.hint && (
                      <div className="mt-2 text-[11px] text-[color:var(--fg-muted)] leading-snug">
                        💡 {step.hint}
                      </div>
                    )}
                    {step.externalUrl && (
                      <a
                        href={step.externalUrl.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block mt-2 text-[11px] text-[color:var(--accent-dark)] hover:underline"
                      >
                        {step.externalUrl.label} ↗
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {guide.officialDocs && guide.officialDocs.length > 0 && (
            <div className="pt-3 border-t border-[var(--border-subtle)] space-y-1">
              <div className="text-[10px] font-mono tracking-widest text-[color:var(--fg-muted)] mb-1">
                OFFICIAL DOCS
              </div>
              {guide.officialDocs.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[12px] text-[color:var(--accent-dark)] hover:underline"
                >
                  📘 {doc.label} ↗
                </a>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-6 py-3 border-t border-[var(--border-subtle)] bg-gray-50 flex justify-end">
          <button type="button" onClick={onClose} className="btn-accent text-[12px]">
            理解した
          </button>
        </div>
      </div>
    </div>
  );
}
