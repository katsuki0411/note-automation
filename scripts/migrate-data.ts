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

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
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
const OLD_DATABASE_URL = process.env.DATABASE_URL;
const NEW_URL = process.env.NEW_SUPABASE_URL;
const NEW_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY || !OLD_DATABASE_URL) {
  console.error("❌ 環境変数が足りません: OLD_SUPABASE_URL/KEY, NEW_SUPABASE_URL/KEY, DATABASE_URL");
  process.exit(1);
}

// 旧 DB は restricted で REST API がブロックされているため、
// Postgres プーラーに直接接続して読み取る (Storage / PostgREST と独立で生きてる)。
const oldPg = postgres(OLD_DATABASE_URL, { ssl: "require", connect_timeout: 30 });
// 旧の admin SDK は user_id を email から引くためだけに使う
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

// 旧 user_id → 新 user_id のマッピング (Email ベースで対応付け)
let userIdMap: Map<string, string> = new Map();

async function buildUserIdMap() {
  console.log("\n👤 旧 → 新 の user_id マッピングを構築中…");
  // 旧の auth.users から SELECT (Postgres 直接接続)
  const oldUsers = await oldPg<Array<{ id: string; email: string | null }>>`
    select id::text as id, email from auth.users
  `;
  console.log(`  旧プロジェクトのユーザー: ${oldUsers.length} 人`);

  // 新の auth.users を list (REST API 経由)
  const { data: newList } = await neu.auth.admin.listUsers();
  const newByEmail = new Map<string, string>();
  for (const u of newList?.users ?? []) {
    if (u.email) newByEmail.set(u.email.toLowerCase(), u.id);
  }
  console.log(`  新プロジェクトのユーザー: ${newByEmail.size} 人`);

  for (const o of oldUsers) {
    if (!o.email) continue;
    const newId = newByEmail.get(o.email.toLowerCase());
    if (newId) {
      userIdMap.set(o.id, newId);
      console.log(`  ✓ ${o.email}: ${o.id.slice(0, 8)}… → ${newId.slice(0, 8)}…`);
    } else {
      console.warn(`  ⚠ ${o.email} が新プロジェクトに見つかりません (Auth で作成してください)`);
    }
  }
  console.log(`  → ${userIdMap.size} 人マッピング完了`);
}

const USER_ID_FIELDS = ["user_id", "owner_id", "created_by", "master_user_id"] as const;

function remapUserId(row: Record<string, unknown>): Record<string, unknown> {
  // user_id / owner_id / created_by / master_user_id を新 ID に置換
  const out = { ...row };
  for (const key of USER_ID_FIELDS) {
    const v = out[key];
    if (typeof v === "string" && userIdMap.has(v)) {
      out[key] = userIdMap.get(v);
    }
  }
  return out;
}

// remap 後、新側に存在する user_id だけ持つ行か判定。
// 該当フィールドが「マップに無い旧 ID のまま」だと FK エラーになるのでスキップ対象。
function hasValidUserIds(row: Record<string, unknown>): boolean {
  const newUserIds = new Set(userIdMap.values());
  for (const key of USER_ID_FIELDS) {
    const v = row[key];
    if (typeof v !== "string") continue;
    if (v.length !== 36) continue; // UUID 以外はスキップ判定対象外
    if (!newUserIds.has(v)) return false;
  }
  return true;
}

async function copyTable(table: string): Promise<{ ok: number; err: number }> {
  console.log(`\n📋 ${table}`);
  let ok = 0;
  let err = 0;
  // 旧 Postgres から SELECT (テーブル名を unsafe で動的指定)
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await oldPg.unsafe(`select * from ${table}`)) as Array<Record<string, unknown>>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠ select failed: ${msg}`);
    return { ok: 0, err: 1 };
  }
  console.log(`  → ${rows.length} 件取得`);
  if (rows.length === 0) {
    console.log(`  ✓ 0件 (空テーブル)`);
    return { ok: 0, err: 0 };
  }
  const remapped = rows.map(remapUserId).filter((r) => {
    const valid = hasValidUserIds(r);
    if (!valid) {
      const orphaned = USER_ID_FIELDS.map((f) => r[f]).filter((v): v is string => typeof v === "string" && v.length === 36 && !new Set(userIdMap.values()).has(v));
      console.log(`  ⏭  skip: 新側に存在しない user_id (${orphaned.join(", ")})`);
    }
    return valid;
  });
  if (remapped.length < rows.length) {
    console.log(`  (${rows.length - remapped.length} 件スキップ後 ${remapped.length} 件 INSERT)`);
  }
  // 500 件ずつバッチで upsert (idempotent)
  const BATCH = 500;
  for (let i = 0; i < remapped.length; i += BATCH) {
    const batch = remapped.slice(i, i + BATCH);
    const { error: insErr } = await neu.from(table).upsert(batch);
    if (insErr) {
      console.warn(`  ⚠ insert failed (rows ${i}〜${i + batch.length - 1}): ${insErr.message}`);
      err++;
    } else {
      ok += batch.length;
    }
  }
  console.log(`  ✓ ${ok}/${rows.length}件 / ${err > 0 ? `エラー${err}` : "成功"}`);
  return { ok, err };
}

async function preCleanNewProject() {
  console.log("\n🧹 新プロジェクトの既存データを依存逆順で削除中…");
  // INSERT 順の逆 (子が先、親が後)
  const reverse = [...TABLES].reverse();
  for (const t of reverse) {
    const { error, count } = await neu.from(t).delete().not("id", "is", null).select("*", { count: "exact", head: true });
    if (error) {
      if (error.message.includes("does not exist")) {
        console.log(`  ⏭  ${t}: テーブル不存在 (スキップ)`);
        continue;
      }
      console.warn(`  ⚠ ${t} delete failed: ${error.message}`);
    } else {
      console.log(`  🗑  ${t}: ${count ?? "?"} 件削除`);
    }
  }
}

async function main() {
  console.log("🚀 データ移行開始");
  console.log(`  OLD: ${OLD_URL}`);
  console.log(`  NEW: ${NEW_URL}`);
  console.log("");
  console.log("⚠ 新プロジェクトに事前にユーザー (info@michisu-inc.com 等) が作成済の前提です。");

  await buildUserIdMap();
  await preCleanNewProject();

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
  await oldPg.end();
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
