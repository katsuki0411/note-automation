import "server-only";
import { sql } from "./db";

// =========================================================
// 執筆者ペルソナ ライブラリ (migration 0018)
// =========================================================
// 記事生成 (/api/generate) の system プロンプトに注入する「執筆者の人格」。
// 1つ作って複数 destination に割り当てられる共通ライブラリ方式。
// destination 側は prompt_config.personaId でこのテーブルの id を参照する。
// =========================================================

export type AuthorPersona = {
  id: string;
  name: string;
  body: string; // 自由記述 (「あなたは35歳、2児を育てる元保育士のブロガー…」)
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
};

function rowToPersona(r: Row): AuthorPersona {
  return {
    id: r.id,
    name: r.name,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listAuthorPersonas(projectId: string): Promise<AuthorPersona[]> {
  const rows = await sql<Row[]>`
    select id, name, body, created_at, updated_at
    from author_personas
    where project_id = ${projectId}
    order by created_at desc
  `;
  return rows.map(rowToPersona);
}

export async function getAuthorPersona(
  projectId: string,
  id: string,
): Promise<AuthorPersona | null> {
  const rows = await sql<Row[]>`
    select id, name, body, created_at, updated_at
    from author_personas
    where project_id = ${projectId} and id = ${id}
    limit 1
  `;
  return rows[0] ? rowToPersona(rows[0]) : null;
}

export async function createAuthorPersona(
  projectId: string,
  userId: string,
  input: { name: string; body: string },
): Promise<AuthorPersona> {
  const rows = await sql<Row[]>`
    insert into author_personas (project_id, user_id, name, body)
    values (${projectId}, ${userId}, ${input.name}, ${input.body})
    returning id, name, body, created_at, updated_at
  `;
  return rowToPersona(rows[0]);
}

export async function updateAuthorPersona(
  projectId: string,
  id: string,
  patch: { name?: string; body?: string },
): Promise<AuthorPersona | null> {
  const rows = await sql<Row[]>`
    update author_personas
       set name = coalesce(${patch.name ?? null}, name),
           body = coalesce(${patch.body ?? null}, body),
           updated_at = now()
     where project_id = ${projectId} and id = ${id}
    returning id, name, body, created_at, updated_at
  `;
  return rows[0] ? rowToPersona(rows[0]) : null;
}

export async function deleteAuthorPersona(projectId: string, id: string): Promise<void> {
  await sql`
    delete from author_personas where project_id = ${projectId} and id = ${id}
  `;
}
