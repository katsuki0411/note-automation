import "server-only";
import { sql } from "./db";

// =========================================================
// 執筆者ペルソナ ライブラリ (migration 0018)
// =========================================================
// 記事生成 (/api/generate) の system プロンプトに注入する「執筆者の人格」。
// 1つ作って複数 destination に割り当てられる共通ライブラリ方式。
// destination 側は prompt_config.personaId でこのテーブルの id を参照する。
// =========================================================

// 共通仕様B (writer_*) に1:1対応する構造化フィールド。
// writer_name は AuthorPersona.name を流用するためここには含めない。
export type AuthorPersonaFields = {
  title?: string;        // writer_title 肩書き
  expertise?: string;    // writer_expertise 専門領域
  achievements?: string; // writer_achievements 主な実績・経歴
  firstPerson?: string;  // writer_first_person 一人称
  tone?: string;         // writer_tone 口調・文体
  values?: string;       // writer_values 価値観・スタンス
  episodes?: string;     // writer_episodes 典型エピソード・一次体験
  vocab?: string;        // writer_vocab よく使う言い回し
  ng?: string;           // writer_ng NG表現
  profileUrl?: string;   // writer_profile_url プロフィールURL
  photoUrl?: string;     // writer_photo_url 顔写真URL
};

export type AuthorPersona = {
  id: string;
  name: string;          // writer_name 兼 表示名
  fields: AuthorPersonaFields; // 構造化フィールド (Phase 2)
  body: string;          // その他補足 (自由記述・任意)。構造化フィールドと併用可
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  fields: AuthorPersonaFields | null;
  body: string;
  created_at: string;
  updated_at: string;
};

function rowToPersona(r: Row): AuthorPersona {
  return {
    id: r.id,
    name: r.name,
    fields: r.fields ?? {},
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listAuthorPersonas(projectId: string): Promise<AuthorPersona[]> {
  const rows = await sql<Row[]>`
    select id, name, fields, body, created_at, updated_at
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
    select id, name, fields, body, created_at, updated_at
    from author_personas
    where project_id = ${projectId} and id = ${id}
    limit 1
  `;
  return rows[0] ? rowToPersona(rows[0]) : null;
}

export async function createAuthorPersona(
  projectId: string,
  userId: string,
  input: { name: string; fields?: AuthorPersonaFields; body?: string },
): Promise<AuthorPersona> {
  const rows = await sql<Row[]>`
    insert into author_personas (project_id, user_id, name, fields, body)
    values (
      ${projectId}, ${userId}, ${input.name},
      ${sql.json((input.fields ?? {}) as Parameters<typeof sql.json>[0])},
      ${input.body ?? ""}
    )
    returning id, name, fields, body, created_at, updated_at
  `;
  return rowToPersona(rows[0]);
}

export async function updateAuthorPersona(
  projectId: string,
  id: string,
  patch: { name?: string; fields?: AuthorPersonaFields; body?: string },
): Promise<AuthorPersona | null> {
  const rows = await sql<Row[]>`
    update author_personas
       set name = coalesce(${patch.name ?? null}, name),
           fields = coalesce(${patch.fields ? sql.json(patch.fields as Parameters<typeof sql.json>[0]) : null}, fields),
           body = coalesce(${patch.body ?? null}, body),
           updated_at = now()
     where project_id = ${projectId} and id = ${id}
    returning id, name, fields, body, created_at, updated_at
  `;
  return rows[0] ? rowToPersona(rows[0]) : null;
}

export async function deleteAuthorPersona(projectId: string, id: string): Promise<void> {
  await sql`
    delete from author_personas where project_id = ${projectId} and id = ${id}
  `;
}
