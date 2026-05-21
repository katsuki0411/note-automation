"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useGeneration } from "./GenerationProvider";

const HIDE_AFTER_DONE_MS = 15000;

export default function GenerationStatusBar() {
  const { state, reset } = useGeneration();
  const [now, setNow] = useState(Date.now());

  const inProgress = state.current !== null || state.queue.length > 0;

  useEffect(() => {
    if (!inProgress) {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
  }, [inProgress]);

  if (state.totalEnqueued === 0) return null;

  const done = state.completed.length + state.failed.length;
  const total = state.totalEnqueued;
  const finishedAge = state.lastFinishAt ? now - state.lastFinishAt : 0;
  if (!inProgress && finishedAge > HIDE_AFTER_DONE_MS) return null;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fixed bottom-6 right-6 z-30 max-w-md w-[min(90vw,420px)]">
      <div className="bg-[color:var(--black)] text-white rounded-2xl shadow-2xl overflow-hidden"
           style={{ boxShadow: "0 24px 48px -16px rgba(0,0,0,0.45)" }}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              {inProgress ? (
                <>
                  <Spinner />
                  <span className="text-[13px] font-semibold">記事生成中…</span>
                </>
              ) : state.failed.length === 0 ? (
                <span className="text-[13px] font-semibold">✓ {state.completed.length}件 完成</span>
              ) : state.completed.length === 0 ? (
                <span className="text-[13px] font-semibold text-red-300">
                  ✗ {state.failed.length}件 失敗
                </span>
              ) : (
                <span className="text-[13px] font-semibold">
                  ✓ {state.completed.length}件 完成 / ✗ {state.failed.length}件 失敗
                </span>
              )}
            </div>
            <button
              onClick={reset}
              className="text-white/40 hover:text-white text-base leading-none"
              title="閉じる"
            >
              ×
            </button>
          </div>

          {inProgress && (
            <>
              <div className="text-[11px] text-white/70 mb-2 truncate" title={state.current?.idea.title ?? ""}>
                {state.current?.idea.title ?? "次のジョブを準備中…"}
              </div>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[color:var(--accent)] transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] font-mono text-white/60 tabular-nums">
                <span>
                  {done}/{total}
                </span>
                <span>残り {state.queue.length + (state.current ? 1 : 0)}件</span>
              </div>
            </>
          )}

          {!inProgress && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-white/60">
                {Math.max(0, Math.ceil((HIDE_AFTER_DONE_MS - finishedAge) / 1000))}秒後に閉じます
              </div>
              <Link
                href="/library"
                className="px-4 py-1.5 rounded-full bg-[color:var(--accent)] text-white text-[12px] font-semibold hover:bg-[color:var(--accent-dark)] transition"
              >
                ライブラリで見る →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin text-[color:var(--accent)]" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
