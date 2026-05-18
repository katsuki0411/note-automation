import type { JSONValue } from "postgres";
import { sql } from "./db";
import type { PostingDestinationRow, Platform } from "./posters";

export async function loadDestinations(): Promise<PostingDestinationRow[]> {
  return await sql<PostingDestinationRow[]>`
    select id, platform, label, config, enabled, created_at
    from posting_destinations
    order by created_at asc
  `;
}

export async function getDestination(
  id: string,
): Promise<PostingDestinationRow | undefined> {
  const rows = await sql<PostingDestinationRow[]>`
    select id, platform, label, config, enabled, created_at
    from posting_destinations where id = ${id}
  `;
  return rows[0];
}

export async function createDestination(input: {
  platform: Platform;
  label: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}): Promise<PostingDestinationRow> {
  const rows = await sql<PostingDestinationRow[]>`
    insert into posting_destinations (platform, label, config, enabled)
    values (${input.platform}, ${input.label}, ${sql.json(input.config as JSONValue)}, ${input.enabled ?? true})
    returning id, platform, label, config, enabled, created_at
  `;
  return rows[0];
}

export async function updateDestination(
  id: string,
  patch: { label?: string; config?: Record<string, unknown>; enabled?: boolean },
): Promise<void> {
  // 動的な部分更新
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.label !== undefined) { sets.push("label"); values.push(patch.label); }
  if (patch.config !== undefined) { sets.push("config"); values.push(patch.config); }
  if (patch.enabled !== undefined) { sets.push("enabled"); values.push(patch.enabled); }
  if (sets.length === 0) return;
  // postgres.js では set ${sql(obj)} の書き方が使える
  const setObj: Record<string, unknown> = {};
  sets.forEach((k, i) => {
    setObj[k] = k === "config" ? sql.json(values[i] as JSONValue) : values[i];
  });
  await sql`update posting_destinations set ${sql(setObj)} where id = ${id}`;
}

export async function deleteDestination(id: string): Promise<void> {
  await sql`delete from posting_destinations where id = ${id}`;
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

export async function saveArticlePosting(input: {
  articleId: string;
  destinationId: string | null;
  destinationLabel: string;
  platform: string;
  status: "success" | "failed";
  externalUrl?: string;
  error?: string;
}): Promise<void> {
  await sql`
    insert into article_postings (
      article_id, destination_id, destination_label, platform, status, external_url, error
    ) values (
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

export async function loadArticlePostings(articleId?: string): Promise<ArticlePostingRow[]> {
  if (articleId) {
    return await sql<ArticlePostingRow[]>`
      select id, article_id, destination_id, destination_label, platform,
             status, external_url, error, posted_at
      from article_postings
      where article_id = ${articleId}
      order by posted_at desc
    `;
  }
  return await sql<ArticlePostingRow[]>`
    select id, article_id, destination_id, destination_label, platform,
           status, external_url, error, posted_at
    from article_postings
    order by posted_at desc
  `;
}
