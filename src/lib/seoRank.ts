import { sql } from "./db";

export type SeoTarget = {
  id: string;
  kw: string;
  targetUrlPrefix: string;
  memo: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SeoRanking = {
  id: string;
  targetId: string;
  rank: number | null;
  foundUrl: string | null;
  totalScanned: number;
  checkedAt: string;
  error: string | null;
};

export type SeoTargetWithLatest = SeoTarget & {
  latest: SeoRanking | null;
  previous: SeoRanking | null;
};

type TargetRow = {
  id: string;
  kw: string;
  target_url_prefix: string;
  memo: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type RankingRow = {
  id: string;
  target_id: string;
  rank: number | null;
  found_url: string | null;
  total_scanned: number;
  checked_at: string;
  error: string | null;
};

function rowToTarget(r: TargetRow): SeoTarget {
  return {
    id: r.id,
    kw: r.kw,
    targetUrlPrefix: r.target_url_prefix,
    memo: r.memo ?? "",
    enabled: r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToRanking(r: RankingRow): SeoRanking {
  return {
    id: r.id,
    targetId: r.target_id,
    rank: r.rank,
    foundUrl: r.found_url,
    totalScanned: r.total_scanned,
    checkedAt: r.checked_at,
    error: r.error,
  };
}

function normalizePrefix(s: string): string {
  return s.trim();
}

export async function listTargets(projectId: string): Promise<SeoTarget[]> {
  const rows = await sql<TargetRow[]>`
    select id, kw, target_url_prefix, memo, enabled, created_at, updated_at
    from seo_targets
    where project_id = ${projectId}
    order by created_at desc
  `;
  return rows.map(rowToTarget);
}

export async function listTargetsWithLatest(projectId: string): Promise<SeoTargetWithLatest[]> {
  const targets = await listTargets(projectId);
  if (targets.length === 0) return [];
  const ids = targets.map((t) => t.id);
  const rankRows = await sql<(RankingRow & { rn: number })[]>`
    select * from (
      select id, target_id, rank, found_url, total_scanned, checked_at, error,
             row_number() over (partition by target_id order by checked_at desc) as rn
      from seo_rankings
      where project_id = ${projectId} and target_id in ${sql(ids)}
    ) t where rn <= 2
  `;
  const byTarget = new Map<string, SeoRanking[]>();
  for (const r of rankRows) {
    const arr = byTarget.get(r.target_id) ?? [];
    arr.push(rowToRanking(r));
    byTarget.set(r.target_id, arr);
  }
  return targets.map((t) => {
    const arr = byTarget.get(t.id) ?? [];
    return { ...t, latest: arr[0] ?? null, previous: arr[1] ?? null };
  });
}

export async function getHistory(
  projectId: string,
  targetId: string,
  limit = 60,
): Promise<SeoRanking[]> {
  const rows = await sql<RankingRow[]>`
    select id, target_id, rank, found_url, total_scanned, checked_at, error
    from seo_rankings
    where project_id = ${projectId} and target_id = ${targetId}
    order by checked_at desc
    limit ${limit}
  `;
  return rows.map(rowToRanking);
}

export type CreateTargetInput = {
  kw: string;
  targetUrlPrefix: string;
  memo?: string;
  enabled?: boolean;
};

export async function createTarget(
  projectId: string,
  userId: string,
  input: CreateTargetInput,
): Promise<SeoTarget> {
  const kw = input.kw.trim();
  const prefix = normalizePrefix(input.targetUrlPrefix);
  if (!kw) throw new Error("キーワードが空です");
  if (!prefix) throw new Error("対象URLが空です");
  if (!/^https?:\/\//i.test(prefix)) throw new Error("対象URLは http:// または https:// で始めてください");

  const dup = await sql<{ id: string }[]>`
    select id from seo_targets
    where kw = ${kw} and target_url_prefix = ${prefix} and project_id = ${projectId}
    limit 1
  `;
  if (dup.length > 0) throw new Error("同じキーワード×URLが既に存在します");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql`
    insert into seo_targets (
      id, project_id, user_id, kw, target_url_prefix, memo, enabled, created_at, updated_at
    ) values (
      ${id}, ${projectId}, ${userId},
      ${kw}, ${prefix}, ${input.memo ?? ""}, ${input.enabled ?? true}, ${now}, ${now}
    )
  `;
  return {
    id,
    kw,
    targetUrlPrefix: prefix,
    memo: input.memo ?? "",
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTarget(
  projectId: string,
  id: string,
  patch: Partial<Omit<SeoTarget, "id" | "createdAt">>,
): Promise<SeoTarget | undefined> {
  const now = new Date().toISOString();
  const prefix = patch.targetUrlPrefix ? normalizePrefix(patch.targetUrlPrefix) : null;
  if (prefix && !/^https?:\/\//i.test(prefix)) {
    throw new Error("対象URLは http:// または https:// で始めてください");
  }
  const rows = await sql<TargetRow[]>`
    update seo_targets set
      kw = coalesce(${patch.kw ?? null}, kw),
      target_url_prefix = coalesce(${prefix}, target_url_prefix),
      memo = coalesce(${patch.memo ?? null}, memo),
      enabled = coalesce(${patch.enabled ?? null}, enabled),
      updated_at = ${now}
    where id = ${id} and project_id = ${projectId}
    returning id, kw, target_url_prefix, memo, enabled, created_at, updated_at
  `;
  return rows.length ? rowToTarget(rows[0]) : undefined;
}

export async function deleteTarget(projectId: string, id: string): Promise<boolean> {
  const result = await sql`
    delete from seo_targets where id = ${id} and project_id = ${projectId}
  `;
  return result.count > 0;
}

// ===== DataForSEO Google SERP API による順位スキャン =====
// 2026-06-03: Brave → DataForSEO に完全移行。
// Google順位ベースで正確、$0.0006/query で経済的。

import { fetchSerpInternal } from "./dataforseo";

// 上位10件まで追跡 (10位以内が事実上のクリック圏)。
const SCAN_DEPTH = 10;

async function fetchSearchPage(query: string): Promise<string[]> {
  const serp = await fetchSerpInternal(query, { depth: SCAN_DEPTH });
  return serp.results.map((r) => r.url).filter(Boolean);
}

export type ScanResult = {
  rank: number | null;
  foundUrl: string | null;
  totalScanned: number;
  error: string | null;
};

export async function scanRank(kw: string, targetUrlPrefix: string): Promise<ScanResult> {
  try {
    // DataForSEO は1リクエストで指定件数取れるのでループ不要
    const urls = await fetchSearchPage(kw);
    for (let i = 0; i < urls.length && i < SCAN_DEPTH; i++) {
      if (urls[i].startsWith(targetUrlPrefix)) {
        return {
          rank: i + 1,
          foundUrl: urls[i],
          totalScanned: Math.min(urls.length, SCAN_DEPTH),
          error: null,
        };
      }
    }
    return {
      rank: null,
      foundUrl: null,
      totalScanned: Math.min(urls.length, SCAN_DEPTH),
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return { rank: null, foundUrl: null, totalScanned: 0, error: msg };
  }
}

export async function recordRanking(
  projectId: string,
  targetId: string,
  result: ScanResult,
): Promise<SeoRanking> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql`
    insert into seo_rankings (
      id, project_id, target_id, rank, found_url, total_scanned, checked_at, error
    ) values (
      ${id}, ${projectId}, ${targetId},
      ${result.rank}, ${result.foundUrl}, ${result.totalScanned}, ${now}, ${result.error}
    )
  `;
  return {
    id,
    targetId,
    rank: result.rank,
    foundUrl: result.foundUrl,
    totalScanned: result.totalScanned,
    checkedAt: now,
    error: result.error,
  };
}

export async function checkTarget(projectId: string, target: SeoTarget): Promise<SeoRanking> {
  const result = await scanRank(target.kw, target.targetUrlPrefix);
  return recordRanking(projectId, target.id, result);
}

// 単一プロジェクトの有効ターゲット全件をチェック
export async function checkAllEnabled(
  projectId: string,
): Promise<{ checked: number; errors: number }> {
  const rows = await sql<TargetRow[]>`
    select id, kw, target_url_prefix, memo, enabled, created_at, updated_at
    from seo_targets
    where project_id = ${projectId} and enabled = true
    order by created_at asc
  `;
  let checked = 0;
  let errors = 0;
  for (const r of rows) {
    const result = await checkTarget(projectId, rowToTarget(r));
    checked++;
    if (result.error) errors++;
  }
  return { checked, errors };
}

// cron 用: 全プロジェクトを横断して、有効ターゲットを全部チェック
export async function checkAllEnabledAllProjects(): Promise<{
  checked: number;
  errors: number;
  projects: number;
}> {
  const projects = await sql<{ id: string }[]>`select id from projects`;
  let checked = 0;
  let errors = 0;
  for (const p of projects) {
    const r = await checkAllEnabled(p.id);
    checked += r.checked;
    errors += r.errors;
  }
  return { checked, errors, projects: projects.length };
}
