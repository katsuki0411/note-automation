"use client";

import { useEffect, useState } from "react";
import type { AutoImageSettings } from "@/lib/clientSettings";

// 記事生成ボタン押下時に「画像も一緒に作るか」を選ばせるポップアップ。
// チェック状態が実際の生成設定になる (両方OFF = 本文テキストのみ)。
// 選択は呼び出し側で localStorage に記憶され、次回の初期値になる。
export default function ImageGenChoiceModal({
  initial,
  title = "記事を生成",
  costHint,
  confirmLabel = "生成する",
  onConfirm,
  onCancel,
}: {
  initial: AutoImageSettings;
  title?: string;
  costHint?: string;
  confirmLabel?: string;
  onConfirm: (s: AutoImageSettings) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<AutoImageSettings>(initial);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const anyImage = s.header || s.body;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-[color:var(--fg-primary)] mb-1">{title}</h2>
        <p className="text-[12px] text-[color:var(--fg-secondary)] mb-4">
          本文完成後に画像も自動生成しますか？（任意・約6円/枚）
        </p>

        <div className="space-y-2.5 mb-4">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={s.header}
              onChange={(e) => setS((p) => ({ ...p, header: e.target.checked }))}
            />
            見出し画像を作る
          </label>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={s.body}
              onChange={(e) => setS((p) => ({ ...p, body: e.target.checked }))}
            />
            本文中の画像を作る
          </label>
        </div>

        {anyImage && costHint && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-4">
            ⚠ {costHint}
          </p>
        )}
        {!anyImage && (
          <p className="text-[11px] text-[color:var(--fg-muted)] mb-4">
            どちらもOFFなら本文テキストだけ生成します（画像は後からライブラリで作れます）。
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost text-[12px] px-3 py-1.5"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onConfirm(s)}
            className="btn-primary text-[12px] px-4 py-1.5"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
