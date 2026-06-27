"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import PageHeader from "@/components/PageHeader";
import { FilterBar, GroupTab } from "@/components/FilterBar";

export type ManualDoc = { id: string; label: string; content: string };

// react-markdown を note 風デザイン (白基調 + ミント #41C9B4) に合わせてスタイリング。
// テーブルは remark-gfm、ASCII 図はコードブロック (ダーク背景・横スクロール) で表示。
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-[21px] md:text-[24px] font-bold tracking-tight text-[color:var(--fg-primary)] mt-2 mb-4 pb-2 border-b border-[var(--border-subtle)]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[16px] md:text-[18px] font-bold text-[color:var(--fg-primary)] mt-9 mb-3 pl-3 border-l-4 border-[color:var(--accent)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] font-semibold text-[color:var(--fg-primary)] mt-6 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[13px] font-semibold text-[color:var(--fg-secondary)] mt-4 mb-1">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-[13.5px] leading-[1.85] text-[color:var(--fg-secondary)] my-3">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-3 space-y-1.5 text-[13px] leading-[1.7] text-[color:var(--fg-secondary)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-3 space-y-1.5 text-[13px] leading-[1.7] text-[color:var(--fg-secondary)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      className="text-[color:var(--accent-dark)] underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[color:var(--fg-primary)]">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-[color:var(--accent)] bg-[color:var(--accent-soft)] rounded-r-lg px-4 py-2 text-[12.5px] text-[color:var(--fg-secondary)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-[var(--border-subtle)]" />,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-[#1f2430] text-gray-100 p-4 text-[12px] leading-[1.7]">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const text = String(children);
    const isBlock = /language-/.test(className || "") || text.includes("\n");
    if (isBlock) {
      return (
        <code className="font-mono whitespace-pre" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="font-mono text-[12px] bg-gray-100 text-[color:var(--accent-dark)] px-1.5 py-0.5 rounded"
        {...props}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[color:var(--accent-soft)]">{children}</thead>,
  th: ({ children }) => (
    <th className="text-left font-semibold text-[color:var(--fg-primary)] px-3 py-2 border-b border-[var(--border-subtle)] whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="align-top px-3 py-2 border-b border-[var(--border-subtle)] text-[color:var(--fg-secondary)]">
      {children}
    </td>
  ),
};

export default function ManualClient({ docs }: { docs: ManualDoc[] }) {
  const [activeId, setActiveId] = useState(docs[0]?.id ?? "");
  const active = docs.find((d) => d.id === activeId) ?? docs[0];

  return (
    <>
      <PageHeader title="マニュアル" description="機能ガイド・評価指標・用語集など、システムの全ドキュメント">
        <FilterBar>
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] -mb-px overflow-x-auto">
            {docs.map((d) => (
              <GroupTab key={d.id} active={activeId === d.id} onClick={() => setActiveId(d.id)}>
                {d.label}
              </GroupTab>
            ))}
          </div>
        </FilterBar>
      </PageHeader>

      <article className="max-w-3xl">
        {active && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {active.content}
          </ReactMarkdown>
        )}
      </article>
    </>
  );
}
