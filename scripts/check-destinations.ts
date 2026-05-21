import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql<{ platform: string; label: string; prompt_config: string }[]>`
    select pd.platform, pd.label, pd.prompt_config::text
    from posting_destinations pd
    join projects p on p.id = pd.project_id
    where p.slug = 'syuhu'
    order by pd.created_at
  `;
  console.log(`syuhu destinations: ${rows.length}件`);
  for (const r of rows) {
    console.log(`  [${r.platform}] ${r.label}  prompt_config=${r.prompt_config}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
