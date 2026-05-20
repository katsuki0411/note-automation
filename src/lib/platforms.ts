import { sql } from "./db";
import type { Platform, PlatformCategory } from "./types";

const SEED_PLATFORMS: Array<Pick<Platform, "domain" | "label" | "category">> = [
  { domain: "chiebukuro.yahoo.co.jp", label: "Yahoo!知恵袋", category: "qa" },
  { domain: "oshiete.goo.ne.jp", label: "教えて!goo", category: "qa" },
  { domain: "okwave.jp", label: "OKWAVE", category: "qa" },
  { domain: "girlschannel.net", label: "ガールズちゃんねる", category: "forum" },
  { domain: "mamastar.jp", label: "ママスタコミュニティ", category: "forum" },
  { domain: "women.benesse.ne.jp", label: "ウィメンズパーク", category: "forum" },
  { domain: "5ch.net", label: "5ちゃんねる", category: "forum" },
  { domain: "kids.nifty.com", label: "ニフティキッズ", category: "forum" },
  { domain: "x.com", label: "X (Twitter)", category: "sns" },
  { domain: "twitter.com", label: "Twitter (旧)", category: "sns" },
  { domain: "threads.net", label: "Threads", category: "sns" },
  { domain: "note.com", label: "note", category: "blog" },
];

type PlatformRow = {
  id: string;
  domain: string;
  label: string;
  category: PlatformCategory;
  enabled: boolean;
  is_default: boolean | null;
  memo: string;
  created_at: string;
  updated_at: string;
};

function rowToPlatform(r: PlatformRow): Platform {
  return {
    id: r.id,
    domain: r.domain,
    label: r.label,
    category: r.category,
    enabled: r.enabled,
    isDefault: r.is_default ?? undefined,
    memo: r.memo ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function seedIfEmpty(projectId: string, userId: string): Promise<void> {
  const cnt = await sql<{ c: string }[]>`
    select count(*)::text as c from platforms where project_id = ${projectId}
  `;
  if (Number(cnt[0]?.c ?? 0) > 0) return;
  const now = new Date().toISOString();
  for (const s of SEED_PLATFORMS) {
    await sql`
      insert into platforms (
        id, project_id, user_id, domain, label, category, enabled, is_default, memo, created_at, updated_at
      ) values (
        ${crypto.randomUUID()}, ${projectId}, ${userId},
        ${s.domain}, ${s.label}, ${s.category}, true, true, '',
        ${now}, ${now}
      )
      on conflict (domain, project_id) do nothing
    `;
  }
}

export async function loadPlatforms(projectId: string, userId: string): Promise<Platform[]> {
  await seedIfEmpty(projectId, userId);
  const rows = await sql<PlatformRow[]>`
    select id, domain, label, category, enabled, is_default, memo, created_at, updated_at
    from platforms
    where project_id = ${projectId}
    order by is_default desc, created_at asc
  `;
  return rows.map(rowToPlatform);
}

export async function getEnabledDomains(projectId: string): Promise<string[]> {
  const rows = await sql<{ domain: string }[]>`
    select domain from platforms
    where project_id = ${projectId} and enabled = true
    order by is_default desc, created_at asc
  `;
  return rows.map((r) => r.domain);
}

export async function platformLabelForDomainAsync(
  projectId: string,
  userId: string,
  domain: string,
): Promise<string> {
  const list = await loadPlatforms(projectId, userId);
  const matched = list.find((p) => domain.includes(p.domain));
  return matched?.label ?? domain;
}

export type CreatePlatformInput = {
  domain: string;
  label: string;
  category: PlatformCategory;
  memo?: string;
  enabled?: boolean;
};

function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export async function createPlatform(
  projectId: string,
  userId: string,
  input: CreatePlatformInput,
): Promise<Platform> {
  const dom = normalizeDomain(input.domain);
  if (!dom) throw new Error("ドメインが空です");

  const dup = await sql<{ id: string }[]>`
    select id from platforms where domain = ${dom} and project_id = ${projectId} limit 1
  `;
  if (dup.length > 0) throw new Error(`既に存在します: ${dom}`);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const label = input.label.trim() || dom;
  await sql`
    insert into platforms (
      id, project_id, user_id, domain, label, category, enabled, is_default, memo, created_at, updated_at
    ) values (
      ${id}, ${projectId}, ${userId},
      ${dom}, ${label}, ${input.category}, ${input.enabled ?? true}, false, ${input.memo ?? ""},
      ${now}, ${now}
    )
  `;
  return {
    id,
    domain: dom,
    label,
    category: input.category,
    enabled: input.enabled ?? true,
    isDefault: false,
    memo: input.memo ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

export async function updatePlatform(
  projectId: string,
  id: string,
  patch: Partial<Omit<Platform, "id" | "createdAt" | "isDefault">>,
): Promise<Platform | undefined> {
  const now = new Date().toISOString();
  const newDomain = patch.domain ? normalizeDomain(patch.domain) : null;
  const rows = await sql<PlatformRow[]>`
    update platforms set
      domain = coalesce(${newDomain}, domain),
      label = coalesce(${patch.label ?? null}, label),
      category = coalesce(${patch.category ?? null}, category),
      enabled = coalesce(${patch.enabled ?? null}, enabled),
      memo = coalesce(${patch.memo ?? null}, memo),
      updated_at = ${now}
    where id = ${id} and project_id = ${projectId}
    returning id, domain, label, category, enabled, is_default, memo, created_at, updated_at
  `;
  return rows.length ? rowToPlatform(rows[0]) : undefined;
}

export async function deletePlatform(projectId: string, id: string): Promise<boolean> {
  const rows = await sql<{ is_default: boolean | null }[]>`
    select is_default from platforms where id = ${id} and project_id = ${projectId}
  `;
  if (rows.length === 0) return false;
  if (rows[0].is_default) {
    // デフォルトは削除せず無効化のみ
    await sql`
      update platforms set enabled = false, updated_at = ${new Date().toISOString()}
      where id = ${id} and project_id = ${projectId}
    `;
    return true;
  }
  const result = await sql`
    delete from platforms where id = ${id} and project_id = ${projectId}
  `;
  return result.count > 0;
}
