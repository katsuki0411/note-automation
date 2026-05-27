"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useGeneration } from "@/components/GenerationProvider";
import { getCache, setCache } from "@/lib/clientCache";
import type { FeedIdea } from "@/lib/types";

const CACHE_SUBJECT = "products:subject";
const CACHE_RESULT = "products:result";
const CACHE_IDEIZED = "products:ideized";

type AIScores = {
  authority: number;
  intentGap: number;
  blogRoom: number;
  llmoAffinity: number;
  mediaMix: number;
  overall: number;
  rationale: string;
};

type DestinationStatus = {
  destinationId: string;
  platform: string;
  label: string;
  platformLabel: string;
  occupied: boolean; // true = 既に競合記事あり / false = 未投稿の隙間
  hits: number;      // 上位30件中の該当 platform 記事数
};

type ScoutCandidate = {
  kw: string;
  intent: string;
  reason: string;
  seoDifficulty: "easy" | "medium" | "hard";
  opportunityScore: number;
  rationale: string;
  buckets: {
    big_ec: number;
    big_media: number;
    individual_blog: number;
    other: number;
  };
  totalScanned: number;
  topUrls: string[];
  ai?: AIScores;
  destinationStatus?: DestinationStatus[];
};

type ScoutResponse = {
  subject: string;
  candidateCount: number;
  candidates: ScoutCandidate[];
};

const DIFF_BADGE: Record<ScoutCandidate["seoDifficulty"], { text: string; cls: string }> = {
  easy: { text: "◎ 易", cls: "bg-green-100 text-green-700" },
  medium: { text: "△ 中", cls: "bg-yellow-100 text-yellow-700" },
  hard: { text: "✕ 難", cls: "bg-red-100 text-red-700" },
};

const INTENT_LABEL: Record<string, string> = {
  info: "情報",
  "how-to": "やり方",
  comparison: "比較",
  trouble: "悩み",
  review: "レビュー",
  purchase: "購入意欲",
};

export default function ProductsClient() {
  const searchParams = useSearchParams();
  const { enqueue } = useGeneration();
  // 初期値を clientCache から復元 (ページ間遷移してもスカウト結果が消えないように)
  const [subject, setSubject] = useState<string>(() => getCache<string>(CACHE_SUBJECT) ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScoutResponse | null>(
    () => getCache<ScoutResponse>(CACHE_RESULT) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [ideized, setIdeized] = useState<Set<string>>(
    () => new Set(getCache<string[]>(CACHE_IDEIZED) ?? []),
  );
  const [generating, setGenerating] = useState<Set<string>>(new Set());

  // ベストセラー画面 → 「この商品でスカウト」遷移時に q クエリで subject 上書き
  useEffect(() => {
    const q = searchParams?.get("q");
    if (q) {
      setSubject(q);
      setCache(CACHE_SUBJECT, q);
    }
  }, [searchParams]);

  // subject / result / ideized を都度キャッシュに書き戻す
  useEffect(() => {
    setCache(CACHE_SUBJECT, subject);
  }, [subject]);
  useEffect(() => {
    if (result) setCache(CACHE_RESULT, result);
  }, [result]);
  useEffect(() => {
    setCache(CACHE_IDEIZED, Array.from(ideized));
  }, [ideized]);

  async function scout() {
    setBusy(true);
    setError(null);
    setResult(null);
    setExpanded(new Set());
    setIdeized(new Set());
    try {
      const res = await fetch("/api/products/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "スカウト失敗");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗");
    } finally {
      setBusy(false);
    }
  }

  // 1候補を ideas (フィード) に追加する。生成された FeedIdea を返す
  async function ideizeCandidate(c: ScoutCandidate): Promise<FeedIdea | null> {
    const res = await fetch("/api/products/ideize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kw: c.kw,
        intent: c.intent,
        reason: c.reason,
        seoDifficulty: c.seoDifficulty,
        opportunityScore: c.opportunityScore,
        rationale: c.rationale,
        subject: result?.subject,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "ネタ化失敗");
    return (data.idea as FeedIdea) ?? null;
  }

  // ネタ化のみ (フィードに残すだけ)
  async function ideize(c: ScoutCandidate) {
    try {
      await ideizeCandidate(c);
      setIdeized((s) => new Set([...s, c.kw]));
    } catch (e) {
      alert(e instanceof Error ? e.message : "ネタ化失敗");
    }
  }

  // ネタ化 + 記事生成キュー投入 (1ボタンで連続実行)
  // destinationStatus が来ていれば「占有あり = 競合あり」の destination は除外し、
  // 占有なしの destination を優先選択 (note 優先 → なければ他)
  async function generateFromCandidate(c: ScoutCandidate) {
    let targetDestId: string | undefined;
    if (c.destinationStatus && c.destinationStatus.length > 0) {
      const available = c.destinationStatus.filter((s) => !s.occupied);
      if (available.length === 0) {
        const occList = c.destinationStatus
          .map((s) => `${s.platformLabel}(${s.hits}件)`)
          .join(", ");
        if (
          !confirm(
            `登録投稿先すべてに既に競合記事があります (${occList})。それでも記事生成しますか?`,
          )
        ) {
          return;
        }
        // 強行: default を使う
      } else {
        // note を優先、それ以外なら最初の available
        const preferred =
          available.find((s) => s.platform === "note") ?? available[0];
        targetDestId = preferred.destinationId;
      }
    }
    setGenerating((s) => new Set([...s, c.kw]));
    try {
      const idea = await ideizeCandidate(c);
      if (!idea) throw new Error("ideaの生成に失敗しました");
      enqueue([idea], targetDestId);
      setIdeized((s) => new Set([...s, c.kw]));
    } catch (e) {
      alert(e instanceof Error ? e.message : "記事生成キュー投入失敗");
    } finally {
      setGenerating((s) => {
        const n = new Set(s);
        n.delete(c.kw);
        return n;
      });
    }
  }

  function toggleExpand(i: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  return (
    <>
      <PageHeader
        title="🛒 商品スカウト"
        description="商品名やお題を入力すると、関連キーワードを自動生成し、Brave で上位30件分析して個人ブログでも勝てそうかを判定します。"
      />

      <div className="max-w-3xl space-y-5">
        <div className="space-y-2">
          <label htmlFor="subject" className="text-[12px] text-[color:var(--fg-secondary)]">
            商品名 / お題 (例: ワイヤレスイヤホン / オーディオブック / 寝る前 ヨガマット)
          </label>
          <div className="flex gap-2">
            <input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && subject.trim() && !busy) scout();
              }}
              placeholder="例: ワイヤレスイヤホン 寝るとき"
              className="input-base flex-1"
              disabled={busy}
            />
            <button
              type="button"
              onClick={scout}
              disabled={busy || !subject.trim()}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              {busy ? "調査中…" : "スカウト開始"}
            </button>
          </div>
          <p className="text-[11px] text-[color:var(--fg-muted)]">
            ⚠ 1回あたり Gemini × 1 / Brave Search × 8〜12 呼ばれます (Brave 無料枠 2,000req/月)
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-700 text-[12px]">{error}</div>
        )}

        {busy && (
          <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-gray-50 text-center text-[13px] text-[color:var(--fg-secondary)]">
            ⏳ 関連KW生成 → Brave 検索で各KWの上位30件を分析中…<br />
            <span className="text-[11px] text-[color:var(--fg-muted)]">
              1〜2分かかる場合があります
            </span>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px]">
                <span className="font-semibold">{result.subject}</span> のスカウト結果:{" "}
                <span className="text-[color:var(--fg-secondary)]">
                  {result.candidateCount} 件の関連KW (機会スコア降順)
                </span>
              </div>
            </div>
            <ul className="space-y-2">
              {result.candidates.map((c, i) => {
                const diff = DIFF_BADGE[c.seoDifficulty];
                const isOpen = expanded.has(i);
                const isIdeized = ideized.has(c.kw);
                return (
                  <li
                    key={i}
                    className="p-3 rounded-lg border border-[var(--border-subtle)] bg-white"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${diff.cls}`}>
                            {diff.text}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            機会 {c.opportunityScore}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                            {INTENT_LABEL[c.intent] ?? c.intent}
                          </span>
                        </div>
                        <div className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                          {c.kw}
                        </div>
                        <div className="text-[11px] text-[color:var(--fg-muted)] mt-0.5">
                          {c.reason}
                        </div>
                        <div className="text-[11px] text-[color:var(--fg-secondary)] mt-1.5 leading-snug">
                          📊 {c.rationale}
                        </div>
                        <div className="text-[10px] text-[color:var(--fg-muted)] mt-1">
                          上位{c.totalScanned}件:
                          EC {c.buckets.big_ec} / 比較メディア {c.buckets.big_media} /
                          個人ブログ {c.buckets.individual_blog} / その他 {c.buckets.other}
                        </div>
                        {c.ai && (
                          <div className="mt-2 p-2 rounded bg-purple-50 border border-purple-100">
                            <div className="flex items-center gap-2 flex-wrap text-[10px]">
                              <span className="font-mono text-purple-700 font-semibold">
                                🤖 AI 総合 {c.ai.overall}
                              </span>
                              <span className="text-[color:var(--fg-muted)]">
                                権威 {c.ai.authority} / intent欠 {c.ai.intentGap} / blog余地 {c.ai.blogRoom} / LLMO {c.ai.llmoAffinity} / mediaMix {c.ai.mediaMix}
                              </span>
                            </div>
                            {c.ai.rationale && (
                              <div className="text-[10px] text-[color:var(--fg-secondary)] mt-1 leading-snug">
                                💡 {c.ai.rationale}
                              </div>
                            )}
                          </div>
                        )}
                        {c.destinationStatus && c.destinationStatus.length > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-[color:var(--fg-muted)] mr-1">投稿先:</span>
                            {c.destinationStatus.map((s) => (
                              <span
                                key={s.destinationId}
                                className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  s.occupied
                                    ? "bg-red-50 text-red-700"
                                    : "bg-green-50 text-green-700"
                                }`}
                                title={
                                  s.occupied
                                    ? `${s.platformLabel} 上位30件に ${s.hits} 件存在 → 投稿しても勝ちにくい`
                                    : `${s.platformLabel} 上位30件に該当記事なし → 投稿チャンス`
                                }
                              >
                                {s.occupied
                                  ? `⚠ ${s.platformLabel} 競合${s.hits}件`
                                  : `✓ ${s.platformLabel} 隙間あり`}
                              </span>
                            ))}
                          </div>
                        )}
                        {isOpen && c.topUrls.length > 0 && (
                          <ul className="mt-2 space-y-0.5 pl-4">
                            {c.topUrls.map((u, j) => (
                              <li key={j} className="text-[10px] text-[color:var(--fg-muted)] truncate">
                                {j + 1}. <a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleExpand(i)}
                          className="text-[10px] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                        >
                          {isOpen ? "閉じる" : "URL"}
                        </button>
                        <button
                          type="button"
                          onClick={() => ideize(c)}
                          disabled={isIdeized}
                          className={`text-[10px] px-2 py-1 rounded whitespace-nowrap ${
                            isIdeized
                              ? "bg-green-100 text-green-700 cursor-default"
                              : "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent)] hover:text-white"
                          }`}
                        >
                          {isIdeized ? "✓ ネタ化済" : "ネタ化"}
                        </button>
                        <button
                          type="button"
                          onClick={() => generateFromCandidate(c)}
                          disabled={generating.has(c.kw)}
                          className="text-[10px] px-2 py-1 rounded whitespace-nowrap bg-[color:var(--accent)] hover:opacity-80 text-white disabled:opacity-50 disabled:cursor-wait"
                          title="ネタ化と同時に記事生成キューに投入"
                        >
                          {generating.has(c.kw) ? "投入中…" : "✍ 記事生成"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="text-[11px] text-[color:var(--fg-muted)]">
              「ネタ化」したKWは <Link href="/" className="text-[color:var(--accent-dark)] hover:underline">ライブフィード</Link> に追加されます。そこから記事生成へ。
            </div>
          </div>
        )}
      </div>
    </>
  );
}
