// マニュアルページ — docs/*.md を単一ソースとして fs 読み込みし、タブで切り替え表示する。
// .md を二重管理しないため、ここでビルド時にファイルを読み込んで Client へ渡す。
// docs/ のバンドル同梱は next.config.ts の outputFileTracingIncludes で保証。

import { readFile } from "node:fs/promises";
import path from "node:path";
import ManualClient, { type ManualDoc } from "./ManualClient";

export const metadata = { title: "マニュアル" };

// 表示順 = 上から「全体像 → スカウト → 用語」の順で読み進められる並び。
// DataForSEO API / DFSセットアップ / Amazonアソシエイト は技術寄りのため
// マニュアルには出さない (docs/*.md 自体はリファレンスとして残してある)。
const DOC_MANIFEST: Array<{ id: string; file: string; label: string }> = [
  { id: "product", file: "PRODUCT_FLOW.md", label: "機能・投稿フロー" },
  { id: "scout", file: "SCOUT_FLOW.md", label: "スカウト実行フロー" },
  { id: "scoring", file: "SCOUT_SCORING.md", label: "評価指標・お宝スコア" },
  { id: "glossary", file: "GLOSSARY.md", label: "用語集" },
];

async function loadDocs(): Promise<ManualDoc[]> {
  const docsDir = path.join(process.cwd(), "docs");
  const docs = await Promise.all(
    DOC_MANIFEST.map(async ({ id, file, label }) => {
      try {
        const content = await readFile(path.join(docsDir, file), "utf8");
        return { id, label, content };
      } catch {
        // ファイルが見つからない場合もページ全体は壊さない
        return { id, label, content: `> このドキュメント（${file}）は現在読み込めませんでした。` };
      }
    })
  );
  return docs;
}

export default async function ManualPage() {
  const docs = await loadDocs();

  return <ManualClient docs={docs} />;
}
