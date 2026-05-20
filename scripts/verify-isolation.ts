import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  const tables = [
    "articles",
    "ideas",
    "hot_keywords",
    "keywords",
    "platforms",
    "seo_targets",
    "seo_rankings",
    "posting_destinations",
    "article_postings",
    "feed_state",
    "hot_keywords_meta",
  ];

  console.log("テーブル別 user_id 完全性チェック:");
  for (const t of tables) {
    const r = await sql<{ n: number; with_user: number }[]>`
      select count(*)::int as n, count(user_id)::int as with_user from ${sql(t)}
    `;
    const ok = r[0].n === r[0].with_user;
    console.log(
      `  ${ok ? "✅" : "❌"} ${t.padEnd(25)} rows=${String(r[0].n).padStart(4)} with_user_id=${r[0].with_user}`,
    );
  }

  const p = await sql<{ user_id: string; display_name: string }[]>`
    select user_id, display_name from profiles
  `;
  console.log(`\nprofiles: ${p.length}件`);
  for (const row of p) {
    console.log(`  ${row.user_id} → "${row.display_name}"`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
