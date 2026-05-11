import postgres from "postgres";
import { promises as fs } from "node:fs";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const sql = postgres(url, { prepare: false, max: 1 });
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const fp = path.join(migrationsDir, f);
    const content = await fs.readFile(fp, "utf-8");
    console.log(`▶ Applying ${f} ...`);
    await sql.unsafe(content);
    console.log(`✓ ${f} applied`);
  }

  // 確認
  const tables = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;
  console.log("\n📊 Tables in public schema:");
  for (const t of tables) console.log(`  - ${t.table_name}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
