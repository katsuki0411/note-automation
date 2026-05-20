import { sql } from "./db";

export type ProjectPersonaKind = "housewife" | "affiliate" | "blog" | "other";

export type ProjectPersonaConfig = {
  kind?: ProjectPersonaKind;
  author_concept?: string[];
  themes?: string[];
  kgi?: string;
  // 将来増やす: cta_style / affiliate_disclosure / writing_tone など
};

export type ProjectRow = {
  id: string;
  slug: string;
  display_name: string;
  persona_config: ProjectPersonaConfig;
  created_at: string;
  updated_at: string;
};

export type ProjectMembership = ProjectRow & {
  role: "owner" | "editor" | "viewer";
};

const SLUG_PATTERN = /^[a-z0-9_-]{2,32}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

// ユーザーが所属する project 一覧 (role 付き)
export async function listProjectsForUser(userId: string): Promise<ProjectMembership[]> {
  return await sql<ProjectMembership[]>`
    select p.id, p.slug, p.display_name, p.persona_config,
           p.created_at, p.updated_at, pm.role
    from projects p
    join project_members pm on pm.project_id = p.id
    where pm.user_id = ${userId}
    order by p.created_at asc
  `;
}

// slug で project を取得 (member かどうかは別途検証)
export async function getProjectBySlug(slug: string): Promise<ProjectRow | undefined> {
  const rows = await sql<ProjectRow[]>`
    select id, slug, display_name, persona_config, created_at, updated_at
    from projects where slug = ${slug} limit 1
  `;
  return rows[0];
}

// ユーザーが指定 project の member か判定 + role 返す
export async function getMembershipRole(
  userId: string,
  projectId: string,
): Promise<"owner" | "editor" | "viewer" | null> {
  const rows = await sql<{ role: string }[]>`
    select role from project_members
    where user_id = ${userId} and project_id = ${projectId}
    limit 1
  `;
  return (rows[0]?.role as "owner" | "editor" | "viewer") ?? null;
}

// 新規 project 作成 + 作成者を owner として member 登録
// トランザクション内で2行 insert + feed_state / hot_keywords_meta の per-project singleton も初期化
export async function createProject(
  userId: string,
  input: {
    slug: string;
    displayName: string;
    personaConfig?: ProjectPersonaConfig;
  },
): Promise<ProjectRow> {
  if (!isValidSlug(input.slug)) {
    throw new Error("slug は 2-32 文字の英小文字 / 数字 / ハイフン / アンダースコアのみ");
  }
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("display_name が空です");

  const dup = await sql<{ id: string }[]>`
    select id from projects where slug = ${input.slug} limit 1
  `;
  if (dup.length > 0) throw new Error(`slug "${input.slug}" は既に使われています`);

  const projectRows = await sql.begin(async (tx) => {
    const inserted = await tx<ProjectRow[]>`
      insert into projects (slug, display_name, persona_config)
      values (
        ${input.slug},
        ${displayName},
        ${tx.json((input.personaConfig ?? {}) as Record<string, unknown>)}
      )
      returning id, slug, display_name, persona_config, created_at, updated_at
    `;
    const project = inserted[0];
    await tx`
      insert into project_members (project_id, user_id, role)
      values (${project.id}, ${userId}, 'owner')
    `;
    // per-project singleton 行を初期化
    await tx`
      insert into feed_state (project_id, user_id, tick_count)
      values (${project.id}, ${userId}, 0)
      on conflict (project_id) do nothing
    `;
    await tx`
      insert into hot_keywords_meta (project_id, user_id)
      values (${project.id}, ${userId})
      on conflict (project_id) do nothing
    `;
    return inserted;
  });
  return projectRows[0];
}

// プロジェクトを削除（owner のみ実行可能）。CASCADE で関連データも全部消える
export async function deleteProject(projectId: string): Promise<void> {
  await sql`delete from projects where id = ${projectId}`;
}

// プロジェクトの display_name / persona_config を更新
export async function updateProject(
  projectId: string,
  patch: { displayName?: string; personaConfig?: ProjectPersonaConfig },
): Promise<ProjectRow | undefined> {
  const now = new Date().toISOString();
  const rows = await sql<ProjectRow[]>`
    update projects set
      display_name = coalesce(${patch.displayName ?? null}, display_name),
      persona_config = coalesce(
        ${patch.personaConfig ? sql.json(patch.personaConfig as Record<string, unknown>) : null},
        persona_config
      ),
      updated_at = ${now}
    where id = ${projectId}
    returning id, slug, display_name, persona_config, created_at, updated_at
  `;
  return rows[0];
}
