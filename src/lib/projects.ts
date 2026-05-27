import "server-only";
import { sql } from "./db";
import {
  isValidKind,
  type ProjectKind,
  type ProjectMembership,
  type ProjectPersonaConfig,
  type ProjectRow,
} from "./projects-types";

// re-export types/constants for server callers
export {
  PROJECT_KIND_LABEL,
  PROJECT_KIND_DESCRIPTION,
  isValidKind,
} from "./projects-types";
export type {
  ProjectKind,
  ProjectMembership,
  ProjectPersonaConfig,
  ProjectPersonaKind,
  ProjectRow,
} from "./projects-types";

const SLUG_PATTERN = /^[a-z0-9_-]{2,32}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

// ユーザーが所属する project 一覧 (role 付き)
export async function listProjectsForUser(userId: string): Promise<ProjectMembership[]> {
  return await sql<ProjectMembership[]>`
    select p.id, p.slug, p.display_name, p.kind, p.persona_config,
           p.created_at, p.updated_at, pm.role
    from projects p
    join project_members pm on pm.project_id = p.id
    where pm.user_id = ${userId}
    order by p.created_at asc
  `;
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | undefined> {
  const rows = await sql<ProjectRow[]>`
    select id, slug, display_name, kind, persona_config, created_at, updated_at
    from projects where slug = ${slug} limit 1
  `;
  return rows[0];
}

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

export async function createProject(
  userId: string,
  input: {
    slug: string;
    displayName: string;
    kind: ProjectKind;
    personaConfig?: ProjectPersonaConfig;
  },
): Promise<ProjectRow> {
  if (!isValidSlug(input.slug)) {
    throw new Error("slug は 2-32 文字の英小文字 / 数字 / ハイフン / アンダースコアのみ");
  }
  if (!isValidKind(input.kind)) {
    throw new Error(`kind が不正です: ${input.kind}`);
  }
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("display_name が空です");

  const dup = await sql<{ id: string }[]>`
    select id from projects where slug = ${input.slug} limit 1
  `;
  if (dup.length > 0) throw new Error(`slug "${input.slug}" は既に使われています`);

  const projectRows = await sql.begin(async (tx) => {
    const inserted = await tx<ProjectRow[]>`
      insert into projects (slug, display_name, kind, persona_config)
      values (
        ${input.slug},
        ${displayName},
        ${input.kind},
        ${tx.json((input.personaConfig ?? {}) as Record<string, unknown>)}
      )
      returning id, slug, display_name, kind, persona_config, created_at, updated_at
    `;
    const project = inserted[0];
    await tx`
      insert into project_members (project_id, user_id, role)
      values (${project.id}, ${userId}, 'owner')
    `;
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
    await tx`
      insert into posting_destinations (
        project_id, user_id, platform, label, config, enabled, prompt_config
      ) values (
        ${project.id},
        ${userId},
        'note',
        'note (note.com)',
        '{}'::jsonb,
        true,
        '{}'::jsonb
      )
    `;
    return inserted;
  });
  return projectRows[0];
}

export async function deleteProject(projectId: string): Promise<void> {
  await sql`delete from projects where id = ${projectId}`;
}

export async function updateProject(
  projectId: string,
  patch: {
    displayName?: string;
    kind?: ProjectKind;
    personaConfig?: ProjectPersonaConfig;
  },
): Promise<ProjectRow | undefined> {
  const now = new Date().toISOString();
  if (patch.kind !== undefined && !isValidKind(patch.kind)) {
    throw new Error(`kind が不正です: ${patch.kind}`);
  }
  const rows = await sql<ProjectRow[]>`
    update projects set
      display_name = coalesce(${patch.displayName ?? null}, display_name),
      kind = coalesce(${patch.kind ?? null}, kind),
      persona_config = coalesce(
        ${patch.personaConfig ? sql.json(patch.personaConfig as Record<string, unknown>) : null},
        persona_config
      ),
      updated_at = ${now}
    where id = ${projectId}
    returning id, slug, display_name, kind, persona_config, created_at, updated_at
  `;
  return rows[0];
}
