/**
 * 旧 Supabase プロジェクト → 新 Supabase プロジェクト のデータ移行スクリプト。
 *
 * 用途: Free Storage 上限超過で restricted になった旧プロジェクトから、
 *       別 Gmail で作った新プロジェクトに全データを移すため。
 *
 * 前提:
 *   - 新プロジェクトでスキーマ作成済 (supabase/_combined_for_new_project.sql 実行済)
 *   - 旧プロジェクトの DB は restricted でも読み取りは通る (storage のみブロック)
 *
 * 使い方:
 *   .env.local に以下を追加:
 *     OLD_SUPABASE_URL=https://[旧ID].supabase.co
 *     OLD_SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *     NEW_SUPABASE_URL=https://[新ID].supabase.co
 *     NEW_SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   実行:
 *     npx tsx scripts/migrate-data.ts
 *
 * 注意:
 *   - auth.users (ログインユーザー) は移行できない (Supabase Auth の制約)
 *     → 移行後、新プロジェクトで再サインアップ → 各 user_id を新 ID にマッピング必要
 *   - service_role キー使用なので RLS を bypass する。実行後は両 service_role を
 *     ローテーション (Dashboard で reset) 推奨。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// .env.local を読み込む
try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
} catch {
  console.warn("(.env.local が読めません — システム環境変数を使います)");
}

const OLD_URL = process.env.OLD_SUPABASE_URL;
const OLD_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY;
const NEW_URL = process.env.NEW_SUPABASE_URL;
const NEW_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error("❌ 環境変数が足りません: OLD_SUPABASE_URL/KEY, NEW_SUPABASE_URL/KEY");
  process.exit(1);
}

const old = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });
const neu = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// 依存順 (外部キーが少ない順) で並べる
const TABLES = [
  "projects",            // 親
  "project_members",     // projects → users (auth.users は別途)
  "posting_destinations",
  "articles",
  "article_postings",
  "keywords",
  "ideas",
  "hot_keywords",
  "platforms",
  "seo_targets",
  "seo_rankings",
  "bestseller_products",
  "discovered_products",
  "product_scout_history",
  "integrations",
  "sub_accounts",
] as const;

async function copyTable(table: string): Promise<{ ok: number; err: number }> {
  console.log(`\n📋 ${table}`);
  let ok = 0;
  let err = 0;
  let from = 0;
  const PAGE = 500;
  for (;;) {
    const { data, error } = await old.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      console.warn(`  ⚠ select failed: ${error.message}`);
      err++;
      break;
    }
    if (!data || data.length === 0) break;
    console.log(`  → batch: rows ${from}〜${from + data.length - 1} (${data.length}件)`);
    // upsert で重複を避けつつ insert (idempotent)
    const { error: insErr } = await neu.from(table).upsert(data);
    if (insErr) {
      console.warn(`  ⚠ insert failed: ${insErr.message}`);
      err++;
    } else {
      ok += data.length;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  ✓ ${ok}件 / ${err > 0 ? `エラー${err}` : "成功"}`);
  return { ok, err };
}

async function main() {
  console.log("🚀 データ移行開始");
  console.log(`  OLD: ${OLD_URL}`);
  console.log(`  NEW: ${NEW_URL}`);
  console.log("");
  console.log("⚠ auth.users (ログインユーザー) は移行されません。");
  console.log("  移行後、新プロジェクトでユーザー再サインアップ → user_id 再マッピングが必要。");

  let total = 0;
  let totalErr = 0;
  for (const t of TABLES) {
    const r = await copyTable(t);
    total += r.ok;
    totalErr += r.err;
  }

  console.log("");
  console.log(`✅ 完了: ${total} 件移行`);
  if (totalErr > 0) console.log(`⚠ エラー: ${totalErr} 件`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. .env.local の SUPABASE_URL / KEY を新しいやつに更新");
  console.log("  2. Vercel Dashboard で同じ環境変数を更新 + redeploy");
  console.log("  3. 動作確認後、両 service_role key を Dashboard で reset");
  console.log("  4. 旧プロジェクトは Settings → General → Delete project で削除");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
