import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  const users = await sql<
    { id: string; email: string | null; created_at: string }[]
  >`select id, email, created_at from auth.users order by created_at`;
  console.log(`登録ユーザー: ${users.length}件`);
  for (const u of users) {
    console.log(`  ${u.id}  ${u.email ?? "(no email)"}  ${u.created_at}`);
  }
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
