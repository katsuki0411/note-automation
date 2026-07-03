"use client";

import { useCallback, useEffect, useState } from "react";
import { getNoteAccount, type NoteAccountResult } from "@/lib/notePost";

// note の投稿先アカウント切替ガイド。
// note は Cookie セッション方式のため、アプリからアカウントを直接切り替えることはできない。
// 「今どのアカウントに投稿するか」を表示し、note.com での切替＋拡張入れ直しの動線を提供する。
export default function NoteAccountModal({
  destinationLabel,
  onClose,
}: {
  destinationLabel: string;
  onClose: () => void;
}) {
  const [acc, setAcc] = useState<NoteAccountResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setAcc(await getNoteAccount());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loggedIn = acc?.ok && acc.loggedIn;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-bold text-[color:var(--fg-primary)]">
            note 投稿先アカウントの切替
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] text-[18px]"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <p className="text-[11px] text-[color:var(--fg-muted)] mb-4">
          「{destinationLabel}」の投稿先＝いま note.com にログインしているアカウントです。
        </p>

        {/* 現在のアカウント */}
        <div className="mb-4">
          <div className="text-[12px] font-semibold text-[color:var(--fg-secondary)] mb-1.5">
            現在の投稿先アカウント
          </div>
          <div
            className={`rounded-lg border px-3 py-2.5 text-[13px] ${
              loggedIn
                ? "bg-[color:var(--accent-soft)] border-[color:var(--accent)]/40 text-[color:var(--accent-dark)]"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            {loading ? (
              "確認中…"
            ) : loggedIn ? (
              <span>
                <span className="font-bold">
                  {acc?.urlname ? `@${acc.urlname}` : ""}
                </span>
                {acc?.nickname ? `（${acc.nickname}）` : ""}
                <span className="ml-1 text-[11px]">に投稿されます</span>
              </span>
            ) : (
              <span>⚠ {acc?.error ?? "アカウントを確認できませんでした"}</span>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="mt-2 text-[11px] text-[color:var(--accent-dark)] hover:underline disabled:opacity-50"
          >
            🔄 再確認
          </button>
        </div>

        {/* ステップ1: 切替 */}
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="text-[12px] font-semibold text-[color:var(--fg-primary)] mb-1.5">
            ① 投稿先アカウントを切り替える
          </div>
          <ol className="text-[12px] text-[color:var(--fg-secondary)] leading-relaxed list-decimal ml-4 space-y-0.5">
            <li>下のボタンで note.com を開く</li>
            <li>右上メニューから<b>ログアウト</b>し、使いたいアカウントで<b>ログイン</b></li>
            <li>この画面に戻って「🔄 再確認」→ 表示が切り替わればOK</li>
          </ol>
          <a
            href="https://note.com/settings/account"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-accent inline-block mt-2 text-[12px] px-3 py-1.5"
          >
            note.com を開いて切替
          </a>
          <p className="text-[10px] text-[color:var(--fg-muted)] mt-1.5">
            ※ アカウントを混ぜたくない場合は、Chrome のプロファイルをアカウントごとに分けて、各プロファイルに拡張を入れるのがおすすめです。
          </p>
        </div>

        {/* ステップ2: 拡張入れ直し */}
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="text-[12px] font-semibold text-[color:var(--fg-primary)] mb-1.5">
            ② 拡張機能を入れ直す（別プロファイルで使う時／更新時）
          </div>
          <ol className="text-[12px] text-[color:var(--fg-secondary)] leading-relaxed list-decimal ml-4 space-y-0.5">
            <li>下のボタンで拡張ZIPをダウンロード</li>
            <li>ZIPを<b>ダブルクリックして解凍</b>（フォルダになる）</li>
            <li>
              <code className="text-[11px] bg-gray-100 px-1 rounded">chrome://extensions</code> を開き「デベロッパーモード」ON
            </li>
            <li>
              「パッケージ化されていない拡張機能を読み込む」で<b>解凍フォルダ</b>を選択（ZIPではなくフォルダ）
            </li>
          </ol>
          <a
            href="/multipostai-poster-extension.zip"
            download
            className="btn-ghost inline-block mt-2 text-[12px] px-3 py-1.5 border border-[var(--border-subtle)]"
          >
            📦 拡張DL（最新版）
          </a>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-[12px] px-4 py-1.5">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
