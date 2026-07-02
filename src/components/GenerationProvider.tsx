"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { readArticleModel, readAutoImageSettings } from "@/lib/clientSettings";
import { autoGenerateArticleImages, hasAutoImageWork } from "@/lib/autoImages";
import type { Article, FeedIdea } from "@/lib/types";
import type { PostingDestinationRow } from "@/lib/posters/types";

type DoneRecord = { id: string; title: string };
type FailRecord = { id: string; title: string; error: string };

type QueueItem = {
  idea: FeedIdea;
  destinationId: string;
};

type GenerationState = {
  queue: QueueItem[];
  current: QueueItem | null;
  completed: DoneRecord[];
  failed: FailRecord[];
  totalEnqueued: number;
  lastFinishAt: number | null;
  destinations: PostingDestinationRow[];
  defaultDestinationId: string | null;
};

const Ctx = createContext<{
  state: GenerationState;
  enqueue: (ideas: FeedIdea[], destinationId?: string) => void;
  reset: () => void;
} | null>(null);

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GenerationState>({
    queue: [],
    current: null,
    completed: [],
    failed: [],
    totalEnqueued: 0,
    lastFinishAt: null,
    destinations: [],
    defaultDestinationId: null,
  });

  const inFlightRef = useRef<string | null>(null);

  // マウント時に project の destinations を取得して default を決める
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/destinations");
        if (!res.ok) return;
        const data = await res.json();
        const destinations: PostingDestinationRow[] = data.destinations ?? [];
        if (aborted) return;
        // note を最優先 default に。なければ最初の enabled な destination
        const noteDest = destinations.find((d) => d.platform === "note" && d.enabled);
        const fallback = destinations.find((d) => d.enabled) ?? destinations[0];
        const defaultId = (noteDest ?? fallback)?.id ?? null;
        setState((s) => ({ ...s, destinations, defaultDestinationId: defaultId }));
      } catch {
        // 取得失敗は黙殺 (enqueue 時にエラーで気付ける)
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  useEffect(() => {
    if (state.current || state.queue.length === 0) return;
    const next = state.queue[0];
    if (inFlightRef.current === next.idea.id) return;
    inFlightRef.current = next.idea.id;

    setState((s) => ({ ...s, queue: s.queue.slice(1), current: next }));

    (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idea: next.idea,
            destinationId: next.destinationId,
            model: readArticleModel(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "生成失敗");
        // 本文完成後、トグルONなら画像も自動生成 (Blob保存)。失敗しても記事は成功扱い。
        const article = data.article as Article | undefined;
        const autoSettings = readAutoImageSettings();
        if (article && hasAutoImageWork(article, autoSettings)) {
          try {
            await autoGenerateArticleImages(article, autoSettings);
          } catch {
            // 画像生成の失敗は本文生成の成否に影響させない
          }
        }
        setState((s) => ({
          ...s,
          completed: [...s.completed, { id: next.idea.id, title: next.idea.title }],
          current: null,
          lastFinishAt: Date.now(),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "失敗";
        setState((s) => ({
          ...s,
          failed: [...s.failed, { id: next.idea.id, title: next.idea.title, error: msg }],
          current: null,
          lastFinishAt: Date.now(),
        }));
      } finally {
        inFlightRef.current = null;
      }
    })();
  }, [state.current, state.queue]);

  const enqueue = useCallback(
    (ideas: FeedIdea[], destinationId?: string) => {
      setState((s) => {
        const destId = destinationId ?? s.defaultDestinationId;
        if (!destId) {
          // destination が無いと記事生成できないので、failed に直接放り込む
          const failed: FailRecord[] = ideas.map((idea) => ({
            id: idea.id,
            title: idea.title,
            error: "投稿先 (destination) が未設定です。設定画面で確認してください。",
          }));
          return {
            ...s,
            failed: [...s.failed, ...failed],
            totalEnqueued: s.totalEnqueued + ideas.length,
            lastFinishAt: Date.now(),
          };
        }
        const items: QueueItem[] = ideas.map((idea) => ({ idea, destinationId: destId }));
        return {
          ...s,
          queue: [...s.queue, ...items],
          totalEnqueued: s.totalEnqueued + ideas.length,
        };
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      queue: [],
      current: null,
      completed: [],
      failed: [],
      totalEnqueued: 0,
      lastFinishAt: null,
    }));
  }, []);

  return <Ctx.Provider value={{ state, enqueue, reset }}>{children}</Ctx.Provider>;
}

export function useGeneration() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGeneration must be used inside GenerationProvider");
  return ctx;
}
