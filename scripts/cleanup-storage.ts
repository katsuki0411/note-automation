/**
 * Supabase Storage の images bucket 配下を全削除するスクリプト。
 *
 * 用途: Storage 1GB 上限を超過してプロジェクトが restricted state になった時の緊急復旧。
 * Service Role Key を使うので、Dashboard が「Failed to retrieve buckets」状態でも動く可能性あり。
 *
 * 使い方:
 *   cd web && npx tsx scripts/cleanup-storage.ts
 *
 * 注意:
 *   - .env.local に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要。
 *   - 削除した画像は復元できない。articles テーブルの image_path は無効リンクになる。
 *   - 投稿先 (note 等) に既にアップ済みの画像はそのまま残る (Supabase Storage と note 内の画像は別物)。
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// .env.local を Node 標準モジュールだけで読み込む (dotenv 依存を避ける)
try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn("(.env.local が読めません — システム環境変数を使います)");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
  process.exit(1);
}

const BUCKET = "images";

async function main() {
  const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`📦 Bucket: ${BUCKET}`);
  console.log("🔍 articles/ 配下のサブディレクトリを列挙中...");

  // articles/ 直下のサブディレクトリ (projectId フォルダ) 一覧
  const { data: subdirs, error: listErr } = await supa.storage
    .from(BUCKET)
    .list("articles", { limit: 1000 });

  if (listErr) {
    console.error("❌ list failed:", listErr.message);
    console.error("Storage は restricted 状態の可能性。Pro プラン or Contact Support 検討してください。");
    process.exit(1);
  }

  console.log(`  → ${subdirs?.length ?? 0} 件のサブディレクトリ`);

  let totalDeleted = 0;
  let totalErrors = 0;

  for (const sub of subdirs ?? []) {
    const subPath = `articles/${sub.name}`;
    const { data: files, error: subListErr } = await supa.storage
      .from(BUCKET)
      .list(subPath, { limit: 1000 });

    if (subListErr) {
      console.warn(`  ⚠ list failed for ${subPath}:`, subListErr.message);
      totalErrors++;
      continue;
    }

    const paths = (files ?? []).map((f) => `${subPath}/${f.name}`);
    if (paths.length === 0) continue;

    console.log(`  🗑  ${subPath}: ${paths.length} 件 削除中…`);
    const { error: delErr } = await supa.storage.from(BUCKET).remove(paths);
    if (delErr) {
      console.warn(`  ⚠ delete failed for ${subPath}:`, delErr.message);
      totalErrors++;
    } else {
      totalDeleted += paths.length;
    }
  }

  // ルート (articles/ 直下に置かれていた孤児ファイル) もチェック
  const rootFiles = (subdirs ?? []).filter((f) => !f.id?.startsWith("00000000")); // ディレクトリでない (≒ id あり) もの
  if (rootFiles.length > 0) {
    const rootPaths = rootFiles.map((f) => `articles/${f.name}`);
    console.log(`  🗑  ルート直下のファイル: ${rootPaths.length} 件 削除中…`);
    const { error } = await supa.storage.from(BUCKET).remove(rootPaths);
    if (error) {
      console.warn("  ⚠ root delete failed:", error.message);
      totalErrors++;
    } else {
      totalDeleted += rootPaths.length;
    }
  }

  console.log("");
  console.log(`✅ 削除完了: ${totalDeleted} 件`);
  if (totalErrors > 0) console.log(`⚠  エラー: ${totalErrors} 件`);
  console.log("");
  console.log("Storage 容量が反映されるまで最大 1 時間程度かかる場合があります。");
  console.log("Supabase Dashboard → Reports → Database → Storage で確認してください。");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
