import postgres from "postgres";

const globalForPg = global as unknown as {
  __pgSql?: ReturnType<typeof postgres>;
};

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in environment");
  return postgres(url, {
    prepare: false, // Supabase Transaction pooler 用
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
  });
}

export const sql = globalForPg.__pgSql ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPg.__pgSql = sql;
