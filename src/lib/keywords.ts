import { sql } from "./db";
import type {
  Keyword,
  KeywordCompetition,
  KeywordIntent,
  KeywordStatus,
  KeywordVolume,
  KeywordsState,
  ThemeId,
} from "./types";

type KeywordRow = {
  id: string;
  theme_id: ThemeId;
  subcategory_id: string;
  kw: string;
  intent: KeywordIntent;
  vol: KeywordVolume;
  comp: KeywordCompetition;
  priority: number;
  memo: string;
  status: KeywordStatus;
  article_ids: string[];
  created_at: string;
  updated_at: string;
};

function rowToKw(r: KeywordRow): Keyword {
  return {
    id: r.id,
    themeId: r.theme_id,
    subcategoryId: r.subcategory_id,
    kw: r.kw,
    intent: r.intent,
    vol: r.vol,
    comp: r.comp,
    priority: r.priority,
    memo: r.memo ?? "",
    status: r.status,
    articleIds: r.article_ids ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function loadKeywords(): Promise<KeywordsState> {
  const rows = await sql<KeywordRow[]>`
    select id, theme_id, subcategory_id, kw, intent, vol, comp,
           priority, memo, status, article_ids, created_at, updated_at
    from keywords
    order by priority desc, created_at desc
  `;
  return { keywords: rows.map(rowToKw) };
}

export async function saveKeywords(_state: KeywordsState): Promise<void> {
  // 互換のため残置。実際にはcreate/update/deleteを個別関数で
}

export function normalizeKw(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function findKeyword(kw: string, themeId?: ThemeId): Promise<Keyword | undefined> {
  const norm = normalizeKw(kw);
  const rows = await sql<KeywordRow[]>`
    select id, theme_id, subcategory_id, kw, intent, vol, comp,
           priority, memo, status, article_ids, created_at, updated_at
    from keywords
    where lower(trim(kw)) = ${norm}
      ${themeId ? sql`and theme_id = ${themeId}` : sql``}
    limit 1
  `;
  return rows.length ? rowToKw(rows[0]) : undefined;
}

export type CreateKeywordInput = {
  themeId: ThemeId;
  subcategoryId: string;
  kw: string;
  intent?: KeywordIntent;
  vol?: KeywordVolume;
  comp?: KeywordCompetition;
  priority?: number;
  memo?: string;
  status?: KeywordStatus;
  articleIds?: string[];
};

export async function createKeyword(input: CreateKeywordInput): Promise<Keyword> {
  const dup = await findKeyword(input.kw, input.themeId);
  if (dup) return dup;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await sql`
    insert into keywords (
      id, theme_id, subcategory_id, kw, intent, vol, comp,
      priority, memo, status, article_ids, created_at, updated_at
    ) values (
      ${id},
      ${input.themeId},
      ${input.subcategoryId},
      ${input.kw.trim()},
      ${input.intent ?? "trouble"},
      ${input.vol ?? "medium"},
      ${input.comp ?? "medium"},
      ${input.priority ?? 50},
      ${input.memo ?? ""},
      ${input.status ?? "untargeted"},
      ${sql.json(input.articleIds ?? [])},
      ${now},
      ${now}
    )
  `;
  return {
    id,
    themeId: input.themeId,
    subcategoryId: input.subcategoryId,
    kw: input.kw.trim(),
    intent: input.intent ?? "trouble",
    vol: input.vol ?? "medium",
    comp: input.comp ?? "medium",
    priority: input.priority ?? 50,
    memo: input.memo ?? "",
    status: input.status ?? "untargeted",
    articleIds: input.articleIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateKeyword(
  id: string,
  patch: Partial<Omit<Keyword, "id" | "createdAt">>,
): Promise<Keyword | undefined> {
  const now = new Date().toISOString();
  const rows = await sql<KeywordRow[]>`
    update keywords set
      theme_id = coalesce(${patch.themeId ?? null}, theme_id),
      subcategory_id = coalesce(${patch.subcategoryId ?? null}, subcategory_id),
      kw = coalesce(${patch.kw ?? null}, kw),
      intent = coalesce(${patch.intent ?? null}, intent),
      vol = coalesce(${patch.vol ?? null}, vol),
      comp = coalesce(${patch.comp ?? null}, comp),
      priority = coalesce(${patch.priority ?? null}, priority),
      memo = coalesce(${patch.memo ?? null}, memo),
      status = coalesce(${patch.status ?? null}, status),
      article_ids = coalesce(${patch.articleIds ? sql.json(patch.articleIds) : null}, article_ids),
      updated_at = ${now}
    where id = ${id}
    returning id, theme_id, subcategory_id, kw, intent, vol, comp,
              priority, memo, status, article_ids, created_at, updated_at
  `;
  return rows.length ? rowToKw(rows[0]) : undefined;
}

export async function deleteKeyword(id: string): Promise<boolean> {
  const result = await sql`delete from keywords where id = ${id}`;
  return result.count > 0;
}

export async function attachArticleToKeyword(keywordId: string, articleId: string) {
  const rows = await sql<{ article_ids: string[] }[]>`
    select article_ids from keywords where id = ${keywordId}
  `;
  if (rows.length === 0) return;
  const ids = rows[0].article_ids ?? [];
  if (!ids.includes(articleId)) ids.push(articleId);
  const now = new Date().toISOString();
  await sql`
    update keywords set
      article_ids = ${sql.json(ids)},
      status = 'covered',
      updated_at = ${now}
    where id = ${keywordId}
  `;
}
