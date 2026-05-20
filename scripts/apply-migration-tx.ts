/**
 * トランザクション付きマイグレーション適用スクリプト
 *
 * 使い方:
 *   npx tsx scripts/apply-migration-tx.ts <migration-file> --dry-run
 *   npx tsx scripts/apply-migration-tx.ts <migration-file> --commit
 *
 *   - --dry-run: トランザクション内で適用 → 件数とスキーマ変化を表示 → ROLLBACK
 *   - --commit : トランザクション内で適用 → 確認後 → COMMIT
 *
 * 既存の apply-migration.ts はディレクトリ内の全SQLを順次流すだけで
 * dry-run / rollback ができないため、本番反映前の検証用にこちらを別途用意。
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const commit = args.includes("--commit");

  if (!file) {
    console.error("Usage: tsx apply-migration-tx.ts <migration-file> [--dry-run | --commit]");
    process.exit(1);
  }
  if (!dryRun && !commit) {
    console.error("--dry-run か --commit のどちらかを指定してください");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL が未設定です");
    process.exit(1);
  }

  const sqlText = await readFile(path.resolve(file), "utf8");
  console.log(`📄 ${file} (${sqlText.length} bytes)`);
  console.log(`🎯 mode: ${dryRun ? "DRY RUN (ROLLBACK 予定)" : "COMMIT"}`);
  console.log("---");

  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
  });

  try {
    const before = await snapshot(sql);
    console.log("📊 Before:");
    printSnapshot(before);

    await sql.begin(async (tx) => {
      console.log("\n🔧 マイグレーション実行中...");
      await tx.unsafe(sqlText);

      const after = await snapshot(tx);
      console.log("\n📊 After (TX内):");
      printSnapshot(after);

      if (dryRun) {
        throw new Error("__DRY_RUN_ROLLBACK__");
      }
      console.log("\n✅ COMMIT します");
    });

    console.log("\n🎉 完了");
  } catch (e) {
    if (e instanceof Error && e.message === "__DRY_RUN_ROLLBACK__") {
      console.log("\n↩️  DRY RUN 完了 (ROLLBACK されました)");
    } else {
      console.error("\n❌ エラー:", e);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

type Snapshot = {
  tables: { table_name: string; rows: number }[];
  userIdCols: { table_name: string }[];
  rls: { table_name: string; rowsecurity: boolean }[];
};

async function snapshot(sql: postgres.Sql | postgres.TransactionSql): Promise<Snapshot> {
  const tables = await sql<{ table_name: string; rows: number }[]>`
    select
      c.relname as table_name,
      c.reltuples::bigint::int as rows
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'articles', 'ideas', 'hot_keywords', 'keywords', 'platforms',
        'seo_targets', 'seo_rankings', 'posting_destinations',
        'article_postings', 'feed_state', 'hot_keywords_meta', 'profiles'
      )
    order by c.relname
  `;
  const userIdCols = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
    order by table_name
  `;
  const rls = await sql<{ table_name: string; rowsecurity: boolean }[]>`
    select c.relname as table_name, c.relrowsecurity as rowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in (
        'articles', 'ideas', 'hot_keywords', 'keywords', 'platforms',
        'seo_targets', 'seo_rankings', 'posting_destinations',
        'article_postings', 'feed_state', 'hot_keywords_meta', 'profiles'
      )
    order by c.relname
  `;
  return { tables, userIdCols, rls };
}

function printSnapshot(s: Snapshot) {
  console.log("  Tables (行数概算):");
  for (const t of s.tables) {
    console.log(`    ${t.table_name.padEnd(25)} ${String(t.rows).padStart(6)} rows`);
  }
  console.log(`\n  user_id 列を持つテーブル: ${s.userIdCols.length}`);
  if (s.userIdCols.length > 0) {
    console.log(`    [${s.userIdCols.map((c) => c.table_name).join(", ")}]`);
  }
  const rlsOn = s.rls.filter((r) => r.rowsecurity);
  console.log(`\n  RLS 有効テーブル: ${rlsOn.length} / ${s.rls.length}`);
  if (rlsOn.length > 0) {
    console.log(`    [${rlsOn.map((r) => r.table_name).join(", ")}]`);
  }
}

main();
