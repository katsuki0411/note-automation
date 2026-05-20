import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  const projects = await sql<
    { id: string; slug: string; display_name: string }[]
  >`select id, slug, display_name from projects order by created_at`;
  console.log(`📦 projects: ${projects.length}件`);
  for (const p of projects) console.log(`  ${p.slug.padEnd(10)} ${p.display_name}  (${p.id})`);

  const members = await sql<
    { project_id: string; user_id: string; role: string; email: string }[]
  >`
    select pm.project_id, pm.user_id, pm.role, u.email
    from project_members pm join auth.users u on u.id = pm.user_id
    order by pm.created_at
  `;
  console.log(`\n👥 project_members: ${members.length}件`);
  for (const m of members) {
    console.log(`  project=${m.project_id.slice(0, 8)}... user=${m.email} role=${m.role}`);
  }

  console.log(`\n🔎 各テーブルの project_id 完全性:`);
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
  for (const t of tables) {
    const r = await sql<{ n: number; with_p: number }[]>`
      select count(*)::int as n, count(project_id)::int as with_p from ${sql(t)}
    `;
    const ok = r[0].n === r[0].with_p;
    console.log(
      `  ${ok ? "✅" : "❌"} ${t.padEnd(25)} rows=${String(r[0].n).padStart(4)} with_project_id=${r[0].with_p}`,
    );
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
