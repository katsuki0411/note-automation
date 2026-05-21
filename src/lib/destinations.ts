import type { JSONValue } from "postgres";
import { sql } from "./db";
import type { PostingDestinationRow, Platform } from "./posters/types";

export async function loadDestinations(
  projectId: string,
): Promise<PostingDestinationRow[]> {
  return await sql<PostingDestinationRow[]>`
    select id, platform, label, config, enabled, created_at, prompt_config
    from posting_destinations
    where project_id = ${projectId}
    order by created_at asc
  `;
}

export async function getDestination(
  projectId: string,
  id: string,
): Promise<PostingDestinationRow | undefined> {
  const rows = await sql<PostingDestinationRow[]>`
    select id, platform, label, config, enabled, created_at, prompt_config
    from posting_destinations
    where id = ${id} and project_id = ${projectId}
  `;
  return rows[0];
}

export async function createDestination(
  projectId: string,
  userId: string,
  input: {
    platform: Platform;
    label: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<PostingDestinationRow> {
  const rows = await sql<PostingDestinationRow[]>`
    insert into posting_destinations (project_id, user_id, platform, label, config, enabled)
    values (
      ${projectId},
      ${userId},
      ${input.platform},
      ${input.label},
      ${sql.json(input.config as JSONValue)},
      ${input.enabled ?? true}
    )
    returning id, platform, label, config, enabled, created_at
  `;
  return rows[0];
}

export async function updateDestination(
  projectId: string,
  id: string,
  patch: {
    label?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    promptConfig?: Record<string, unknown>;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.label !== undefined) { sets.push("label"); values.push(patch.label); }
  if (patch.config !== undefined) { sets.push("config"); values.push(patch.config); }
  if (patch.enabled !== undefined) { sets.push("enabled"); values.push(patch.enabled); }
  if (patch.promptConfig !== undefined) { sets.push("prompt_config"); values.push(patch.promptConfig); }
  if (sets.length === 0) return;
  const setObj: Record<string, unknown> = {};
  sets.forEach((k, i) => {
    setObj[k] = (k === "config" || k === "prompt_config")
      ? sql.json(values[i] as JSONValue)
      : values[i];
  });
  await sql`
    update posting_destinations set ${sql(setObj)}
    where id = ${id} and project_id = ${projectId}
  `;
}

export async function deleteDestination(
  projectId: string,
  id: string,
): Promise<void> {
  await sql`
    delete from posting_destinations
    where id = ${id} and project_id = ${projectId}
  `;
}

export type ArticlePostingRow = {
  id: string;
  article_id: string;
  destination_id: string | null;
  destination_label: string;
  platform: string;
  status: "success" | "failed";
  external_url: string | null;
  error: string | null;
  posted_at: string;
};

export async function saveArticlePosting(
  projectId: string,
  userId: string,
  input: {
    articleId: string;
    destinationId: string | null;
    destinationLabel: string;
    platform: string;
    status: "success" | "failed";
    externalUrl?: string;
    error?: string;
  },
): Promise<void> {
  await sql`
    insert into article_postings (
      project_id, user_id, article_id, destination_id, destination_label,
      platform, status, external_url, error
    ) values (
      ${projectId},
      ${userId},
      ${input.articleId},
      ${input.destinationId},
      ${input.destinationLabel},
      ${input.platform},
      ${input.status},
      ${input.externalUrl ?? null},
      ${input.error ?? null}
    )
  `;
}

export async function loadArticlePostings(
  projectId: string,
  articleId?: string,
): Promise<ArticlePostingRow[]> {
  if (articleId) {
    return await sql<ArticlePostingRow[]>`
      select id, article_id, destination_id, destination_label, platform,
             status, external_url, error, posted_at
      from article_postings
      where project_id = ${projectId} and article_id = ${articleId}
      order by posted_at desc
    `;
  }
  return await sql<ArticlePostingRow[]>`
    select id, article_id, destination_id, destination_label, platform,
           status, external_url, error, posted_at
    from article_postings
    where project_id = ${projectId}
    order by posted_at desc
  `;
}
