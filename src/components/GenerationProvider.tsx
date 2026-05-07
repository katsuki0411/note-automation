"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { FeedIdea } from "@/lib/types";

type DoneRecord = { id: string; title: string };
type FailRecord = { id: string; title: string; error: string };

type GenerationState = {
  queue: FeedIdea[];
  current: FeedIdea | null;
  completed: DoneRecord[];
  failed: FailRecord[];
  totalEnqueued: number;
  lastFinishAt: number | null;
};

const Ctx = createContext<{
  state: GenerationState;
  enqueue: (ideas: FeedIdea[]) => void;
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
  });

  // worker: queueに何かあって currentが空ならlift→fetch
  useEffect(() => {
    if (state.current || state.queue.length === 0) return;
    const next = state.queue[0];
    setState((s) => ({ ...s, queue: s.queue.slice(1), current: next }));

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "生成失敗");
        if (cancelled) return;
        setState((s) => ({
          ...s,
          completed: [...s.completed, { id: next.id, title: next.title }],
          current: null,
          lastFinishAt: Date.now(),
        }));
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "失敗";
        setState((s) => ({
          ...s,
          failed: [...s.failed, { id: next.id, title: next.title, error: msg }],
          current: null,
          lastFinishAt: Date.now(),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.current, state.queue]);

  const enqueue = useCallback((ideas: FeedIdea[]) => {
    setState((s) => ({
      ...s,
      queue: [...s.queue, ...ideas],
      totalEnqueued: s.totalEnqueued + ideas.length,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      queue: [],
      current: null,
      completed: [],
      failed: [],
      totalEnqueued: 0,
      lastFinishAt: null,
    });
  }, []);

  return <Ctx.Provider value={{ state, enqueue, reset }}>{children}</Ctx.Provider>;
}

export function useGeneration() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGeneration must be used inside GenerationProvider");
  return ctx;
}
