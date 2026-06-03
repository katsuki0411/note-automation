import "server-only";
import type { JSONValue } from "postgres";
import { sql } from "./db";

// =========================================================
// API 連携設定の読み書き + env フォールバック
// =========================================================
// プロジェクト単位 / ユーザー単位の2階層。設定画面で UI 入力 → DB 保存。
// 利用側 (Amazon アソシエイト付与・記事生成 etc) は get*() 経由でDB→envの順に解決する。
// =========================================================

export type ProjectIntegrationKind = "amazon_associate" | "a8_net";
// brave_search は 2026-06-03 廃止 (DataForSEO に完全移行済み)
export type UserIntegrationKind =
  | "gemini"
  | "claude"
  | "ahrefs"
  | "dataforseo";

export type IntegrationRow<T = Record<string, unknown>> = {
  config: T;
  enabled: boolean;
  updated_at: string;
};

// ---------------- project_integrations ----------------

export async function getProjectIntegration<T = Record<string, unknown>>(
  projectId: string,
  kind: ProjectIntegrationKind,
): Promise<IntegrationRow<T> | null> {
  const rows = await sql<IntegrationRow<T>[]>`
    select config, enabled, updated_at
    from project_integrations
    where project_id = ${projectId} and kind = ${kind}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listProjectIntegrations(
  projectId: string,
): Promise<Record<ProjectIntegrationKind, IntegrationRow | null>> {
  const rows = await sql<{ kind: ProjectIntegrationKind; config: Record<string, unknown>; enabled: boolean; updated_at: string }[]>`
    select kind, config, enabled, updated_at
    from project_integrations
    where project_id = ${projectId}
  `;
  const map: Record<string, IntegrationRow | null> = {
    amazon_associate: null,
    a8_net: null,
  };
  for (const r of rows) {
    map[r.kind] = { config: r.config, enabled: r.enabled, updated_at: r.updated_at };
  }
  return map as Record<ProjectIntegrationKind, IntegrationRow | null>;
}

export async function upsertProjectIntegration(
  projectId: string,
  kind: ProjectIntegrationKind,
  config: Record<string, unknown>,
  enabled = true,
): Promise<void> {
  await sql`
    insert into project_integrations (project_id, kind, config, enabled, updated_at)
    values (${projectId}, ${kind}, ${sql.json(config as JSONValue)}, ${enabled}, now())
    on conflict (project_id, kind) do update set
      config = excluded.config,
      enabled = excluded.enabled,
      updated_at = now()
  `;
}

// ---------------- user_integrations ----------------

export async function getUserIntegration<T = Record<string, unknown>>(
  userId: string,
  kind: UserIntegrationKind,
): Promise<IntegrationRow<T> | null> {
  const rows = await sql<IntegrationRow<T>[]>`
    select config, enabled, updated_at
    from user_integrations
    where user_id = ${userId} and kind = ${kind}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listUserIntegrations(
  userId: string,
): Promise<Record<UserIntegrationKind, IntegrationRow | null>> {
  const rows = await sql<{ kind: UserIntegrationKind; config: Record<string, unknown>; enabled: boolean; updated_at: string }[]>`
    select kind, config, enabled, updated_at
    from user_integrations
    where user_id = ${userId}
  `;
  const map: Record<string, IntegrationRow | null> = {
    gemini: null,
    claude: null,
    ahrefs: null,
    dataforseo: null,
  };
  for (const r of rows) {
    map[r.kind] = { config: r.config, enabled: r.enabled, updated_at: r.updated_at };
  }
  return map as Record<UserIntegrationKind, IntegrationRow | null>;
}

export async function upsertUserIntegration(
  userId: string,
  kind: UserIntegrationKind,
  config: Record<string, unknown>,
  enabled = true,
): Promise<void> {
  await sql`
    insert into user_integrations (user_id, kind, config, enabled, updated_at)
    values (${userId}, ${kind}, ${sql.json(config as JSONValue)}, ${enabled}, now())
    on conflict (user_id, kind) do update set
      config = excluded.config,
      enabled = excluded.enabled,
      updated_at = now()
  `;
}

// ---------------- env フォールバック関数 (利用側 lib 用) ----------------

/**
 * Gemini API キー: user_integrations → env.GEMINI_API_KEY の順
 */
export async function resolveGeminiKey(userId: string): Promise<string | null> {
  const row = await getUserIntegration<{ api_key?: string }>(userId, "gemini");
  const dbKey = row?.enabled ? row.config.api_key?.trim() : undefined;
  return dbKey || process.env.GEMINI_API_KEY || null;
}

/**
 * Claude API キー: user_integrations → env.ANTHROPIC_API_KEY の順
 */
export async function resolveClaudeKey(userId: string): Promise<string | null> {
  const row = await getUserIntegration<{ api_key?: string }>(userId, "claude");
  const dbKey = row?.enabled ? row.config.api_key?.trim() : undefined;
  return dbKey || process.env.ANTHROPIC_API_KEY || null;
}

/**
 * Ahrefs API トークン: user_integrations → env.AHREFS_API_TOKEN の順
 */
export async function resolveAhrefsToken(userId: string): Promise<string | null> {
  const row = await getUserIntegration<{ api_token?: string }>(userId, "ahrefs");
  const dbKey = row?.enabled ? row.config.api_token?.trim() : undefined;
  return dbKey || process.env.AHREFS_API_TOKEN || null;
}

/**
 * DataForSEO 認証情報: user_integrations → env (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD) の順
 * Basic 認証なので login + password の2フィールド構成
 */
export type DataForSeoCredentials = { login: string; password: string };
export async function resolveDataForSeoCredentials(
  userId: string,
): Promise<DataForSeoCredentials | null> {
  const row = await getUserIntegration<{ login?: string; password?: string }>(
    userId,
    "dataforseo",
  );
  if (row?.enabled) {
    const login = row.config.login?.trim();
    const password = row.config.password?.trim();
    if (login && password) return { login, password };
  }
  const envLogin = process.env.DATAFORSEO_LOGIN?.trim();
  const envPass = process.env.DATAFORSEO_PASSWORD?.trim();
  if (envLogin && envPass) return { login: envLogin, password: envPass };
  return null;
}

/**
 * Amazon アソシエイト設定: プロジェクトごと
 */
export type AmazonAssociateConfig = {
  tracking_id?: string;       // 例: "yourname-22"
  pa_api_access_key?: string;
  pa_api_secret_key?: string;
  marketplace?: string;       // "www.amazon.co.jp" 等
};

export async function getAmazonAssociate(
  projectId: string,
): Promise<AmazonAssociateConfig | null> {
  const row = await getProjectIntegration<AmazonAssociateConfig>(projectId, "amazon_associate");
  if (!row?.enabled) return null;
  return row.config;
}

/**
 * A8.net 設定: プロジェクトごと
 */
export type A8NetConfig = {
  media_id?: string;
  default_sid?: string;
};

export async function getA8Net(projectId: string): Promise<A8NetConfig | null> {
  const row = await getProjectIntegration<A8NetConfig>(projectId, "a8_net");
  if (!row?.enabled) return null;
  return row.config;
}
