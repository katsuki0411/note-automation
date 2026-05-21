"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";

type FieldKey =
  | "role"
  | "authorProfile"
  | "audience"
  | "tone"
  | "dos"
  | "donts"
  | "structure"
  | "cta"
  | "platformConstraints"
  | "customNotes";

const FIELDS: { key: FieldKey; label: string; hint: string; placeholder: string; rows: number }[] = [
  {
    key: "role",
    label: "役割",
    hint: "AIに与える役割定義。「あなたは…のライターです」など",
    placeholder: "例: あなたは個人開発エンジニア兼note ライターです。読者のIT知識に合わせて優しく書きます。",
    rows: 3,
  },
  {
    key: "authorProfile",
    label: "著者プロフィール",
    hint: "記事内で「この記事を書いた人」セクションに使う著者情報。Markdown 可",
    placeholder: "例: **山田太郎** ｜ フリーランスエンジニア\n個人開発で...",
    rows: 5,
  },
  {
    key: "audience",
    label: "ターゲット読者",
    hint: "誰に向けて書くか。年齢層・属性・抱えてる悩み・ITレベルなど",
    placeholder: "例: 30〜40代のフリーランス。本業の事業者で、効率化に興味あり、ChatGPTは使ったことある程度",
    rows: 4,
  },
  {
    key: "tone",
    label: "文体・トーン",
    hint: "敬体/常体、絵文字、結論の出し方、共感の重さなど",
    placeholder: "例: 敬体・絵文字あり・結論先出し・「〜ですよね」など共感トーン",
    rows: 3,
  },
  {
    key: "dos",
    label: "必須事項 (1項目1行)",
    hint: "毎回必ず守るべきルール。例: TL;DR を冒頭に入れる、見出しを目次型にする等",
    placeholder: "TL;DR を冒頭に入れる\nH2 / H3 の見出しを目次型にする\n末尾に FAQ Q&A を3問入れる",
    rows: 6,
  },
  {
    key: "donts",
    label: "禁事項 (1項目1行)",
    hint: "絶対やってはいけないこと。トーンや表現の NG リスト",
    placeholder: "煽り表現を使わない\n専門用語をそのまま使わない (使うなら直後にカッコで補足)\nアフィリンクは記事冒頭に置かない",
    rows: 6,
  },
  {
    key: "structure",
    label: "構造ルール",
    hint: "見出し構成・文字数目安・テンプレート",
    placeholder: "9章構成: 導入→既存ツール限界→解決策→実例→FAQ→まとめ→著者→CTA\n本文 3000-4000 文字\n見出し H2 / H3 のみ",
    rows: 6,
  },
  {
    key: "cta",
    label: "CTA 指示",
    hint: "末尾の Call To Action の方針。なし/控えめ/強め/具体的文言など",
    placeholder: "例: 末尾に「相談歓迎」のメッセージを2行で。売り込み感NG",
    rows: 4,
  },
  {
    key: "platformConstraints",
    label: "プラットフォーム固有制約",
    hint: "投稿先サービス固有の制限・推奨フォーマット",
    placeholder: "例: noteのタイトルは24文字以内。見出し画像は1280x670 推奨。本文先頭の段落 (150字) が抜粋",
    rows: 4,
  },
  {
    key: "customNotes",
    label: "補足・自由メモ",
    hint: "上記の項目に当てはまらない指示。優先度高めで AI に伝えたい補足",
    placeholder: "例: 記事ごとに季節感を1箇所入れる / 引用ブロックは1記事に1〜2回まで",
    rows: 5,
  },
];

function buildPreview(values: Record<FieldKey, string>): string {
  const sections: string[] = [];
  for (const f of FIELDS) {
    const v = values[f.key]?.trim();
    if (v) sections.push(`## ${f.label}\n${v}`);
  }
  return sections.length > 0 ? sections.join("\n\n") : "(まだ何も入力されていません)";
}

type Props = {
  destinationId: string;
  destinationLabel: string;
  platformLabel: string;
  initialPromptConfig: Record<string, string>;
  projectKind: string | null;
};

export default function PromptEditClient({
  destinationId,
  destinationLabel,
  platformLabel,
  initialPromptConfig,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"form" | "preview">("form");
  const [values, setValues] = useState<Record<FieldKey, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELDS) {
      init[f.key] = (initialPromptConfig?.[f.key] as string) ?? "";
    }
    return init as Record<FieldKey, string>;
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const isConfigured = useMemo(
    () => Object.values(values).some((v) => v.trim().length > 0),
    [values],
  );

  function update(key: FieldKey, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      // 空文字の項目は送らない (DB側を { } 寄りに保つ)
      const promptConfig: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = values[f.key].trim();
        if (v) promptConfig[f.key] = v;
      }
      const res = await fetch(`/api/destinations/${destinationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptConfig }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失敗");
      setMessage({ kind: "success", text: "保存しました" });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "保存失敗" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${destinationLabel} のプロンプト編集`}
        description={`プラットフォーム: ${platformLabel} / この投稿先で記事生成する時に使うシステムプロンプトを項目別に編集します。`}
      >
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px">
            <GroupTab active={tab === "form"} onClick={() => setTab("form")}>
              項目別フォーム
            </GroupTab>
            <GroupTab active={tab === "preview"} onClick={() => setTab("preview")}>
              プレビュー
            </GroupTab>
          </div>
        </FilterBar>
      </PageHeader>

      <div className="max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/settings"
            className="text-[12px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)]"
          >
            ← 設定に戻る
          </Link>
          <div className="flex items-center gap-3">
            {!isConfigured && (
              <span className="text-[11px] text-orange-600">⚠ プロンプトが入っていません</span>
            )}
            {message && (
              <span
                className={`text-[11px] ${message.kind === "success" ? "text-[color:var(--accent-dark)]" : "text-red-600"}`}
              >
                {message.text}
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>

        {tab === "form" ? (
          <div className="space-y-5">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={f.key} className="text-[13px] font-semibold text-[color:var(--fg-primary)]">
                    {f.label}
                  </label>
                  <span className="text-[10px] text-[color:var(--fg-muted)]">
                    {values[f.key].trim().length > 0 ? `${values[f.key].length} 文字` : "未入力"}
                  </span>
                </div>
                <p className="text-[11px] text-[color:var(--fg-muted)]">{f.hint}</p>
                <textarea
                  id={f.key}
                  value={values[f.key]}
                  onChange={(e) => update(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={f.rows}
                  className="input-base w-full font-mono text-[12px] leading-relaxed"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[12px] text-[color:var(--fg-secondary)]">
              これが記事生成時に AI に渡される system プロンプトです（項目を連結して組み立て）。
            </div>
            <pre className="text-[12px] leading-relaxed p-4 rounded-lg border border-[var(--border-subtle)] bg-gray-50 whitespace-pre-wrap font-mono max-h-[600px] overflow-y-auto">
              {buildPreview(values)}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}
