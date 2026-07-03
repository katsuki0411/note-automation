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
      const ideaId = next.idea.id;
      const destId = next.destinationId;
      // サーバー時刻とのずれマージン込みの「この生成の開始時刻」
      const sinceMs = Date.now() - 2 * 60_000;
      let settled = false;

      const complete = async (article?: Article) => {
        if (settled) return;
        settled = true;
        // 本文完成後、トグルONなら画像も自動生成 (Blob保存)。失敗しても記事は成功扱い。
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
          completed: [...s.completed, { id: ideaId, title: next.idea.title }],
          current: null,
          lastFinishAt: Date.now(),
        }));
        inFlightRef.current = null;
      };

      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        setState((s) => ({
          ...s,
          failed: [...s.failed, { id: ideaId, title: next.idea.title, error: msg }],
          current: null,
          lastFinishAt: Date.now(),
        }));
        inFlightRef.current = null;
      };

      // この生成で新規保存された記事がDBに現れたかを確認する。
      // 本番(Vercel)経由の長時間応答は途中で接続が切れることがあり、その場合も
      // サーバー側は処理を続けて保存するため、応答に頼らず保存の事実で完了判定する。
      const findSaved = async (): Promise<Article | null> => {
        try {
          const res = await fetch("/api/articles");
          if (!res.ok) return null;
          const data = await res.json();
          const arts = (data.articles ?? []) as Article[];
          return (
            arts.find(
              (a) =>
                (a.idea as FeedIdea | undefined)?.id === ideaId &&
                a.destinationId === destId &&
                new Date(a.createdAt).getTime() >= sinceMs,
            ) ?? null
          );
        } catch {
          return null;
        }
      };

      // 保険ポーリング: fetch の応答が来なくても、保存済みが確認できたら完了にする
      const pollTimer = setInterval(async () => {
        if (settled) return;
        const hit = await findSaved();
        if (hit) await complete(hit);
      }, 30_000);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idea: next.idea,
            destinationId: destId,
            model: readArticleModel(),
          }),
          // 無応答のまま固まるのを防ぐ (サーバーの maxDuration=300 と同じ上限)
          signal: AbortSignal.timeout(300_000),
        });
        const data = await res.json();
        if (!res.ok) {
          // サーバーが明示的にエラーを返した = 失敗で確定 (ポーリング不要)
          fail((data as { error?: string }).error ?? "生成失敗");
        } else {
          await complete(data.article as Article | undefined);
        }
      } catch (e) {
        // ここに来るのは応答を受け取れなかったケース (切断 / タイムアウト)。
        // サーバー側で完了している可能性が高いので、保存確認に2分の猶予を与える。
        if (!settled) {
          const deadline = Date.now() + 2 * 60_000;
          let hit = await findSaved();
          while (!hit && !settled && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 15_000));
            if (settled) break;
            hit = await findSaved();
          }
          if (hit) {
            await complete(hit);
          } else {
            fail(
              e instanceof Error && e.name === "TimeoutError"
                ? "応答がないまま5分が経過しました（サーバー側で完了した場合はライブラリに表示されます）"
                : e instanceof Error
                  ? e.message
                  : "失敗",
            );
          }
        }
      } finally {
        clearInterval(pollTimer);
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
