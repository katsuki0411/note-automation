import "server-only";
import { sql } from "./db";
import { supabaseAdmin } from "./supabase/admin";

// =========================================================
// サブアカウント管理 (マスターがスタッフ用ログインを発行)
// =========================================================

/**
 * env MASTER_USER_EMAIL で指定したメアドのユーザーがマスター。
 * 設定タブの「アカウント」を見られるのはマスターのみ。
 */
export function isMasterEmail(email: string | null | undefined): boolean {
  const master = process.env.MASTER_USER_EMAIL?.trim().toLowerCase();
  if (!master) return false;
  return (email ?? "").trim().toLowerCase() === master;
}

export type SubAccountRow = {
  id: string;
  sub_user_id: string;
  sub_email: string;
  created_at: string;
  // 所属している project_members.role (主に "editor"。複数プロジェクトあるが代表値)
  role: string | null;
  // どの project に所属しているか (display_name の配列)
  project_names: string[];
};

/**
 * マスター視点で「自分が発行したサブアカウント」を一覧取得。
 * auth.users から email を、project_members から role と所属プロジェクトを集める。
 */
export async function listSubAccounts(masterUserId: string): Promise<SubAccountRow[]> {
  const rows = await sql<
    {
      id: string;
      sub_user_id: string;
      created_at: string;
    }[]
  >`
    select id, sub_user_id, created_at
    from sub_accounts
    where master_user_id = ${masterUserId}
    order by created_at desc
  `;
  if (rows.length === 0) return [];

  // 各 sub の email を auth.users から (admin 経由でしか引けない)
  const admin = supabaseAdmin();
  const enriched: SubAccountRow[] = [];
  for (const r of rows) {
    const { data: u } = await admin.auth.admin.getUserById(r.sub_user_id);
    const email = u?.user?.email ?? "(削除済み)";
    const projects = await sql<{ display_name: string; role: string }[]>`
      select p.display_name, pm.role
      from project_members pm
      join projects p on p.id = pm.project_id
      where pm.user_id = ${r.sub_user_id}
    `;
    enriched.push({
      id: r.id,
      sub_user_id: r.sub_user_id,
      sub_email: email,
      created_at: r.created_at,
      role: projects[0]?.role ?? null,
      project_names: projects.map((p) => p.display_name),
    });
  }
  return enriched;
}

/**
 * サブアカウントを新規作成。
 * - Supabase Auth に email/password で作成 (email_confirm=true で確認メール不要)
 * - master の所属する全 project に editor として project_members 追加
 * - sub_accounts テーブルに親子関係を記録
 */
export async function createSubAccount(
  masterUserId: string,
  input: { email: string; password: string },
): Promise<{ subUserId: string; projectCount: number }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email) throw new Error("メアドが空です");
  if (!password || password.length < 8) throw new Error("パスワードは8文字以上必須");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("メアド形式が不正です");

  const admin = supabaseAdmin();

  // ステップ1: auth.users に新規作成
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // メアド認証は省略
  });
  if (createErr) {
    throw new Error(`サブアカウント作成失敗: ${createErr.message}`);
  }
  const subUserId = created?.user?.id;
  if (!subUserId) throw new Error("サブアカウントの user_id が取得できませんでした");

  // ステップ2: マスターの所属する全 project に editor として参加
  const projects = await sql<{ project_id: string }[]>`
    select project_id from project_members where user_id = ${masterUserId}
  `;
  if (projects.length === 0) {
    // マスターがプロジェクト未所属 = 普通起きないが念のため auth.users だけ作って終わり
    return { subUserId, projectCount: 0 };
  }
  // project_members に一括 INSERT
  await sql`
    insert into project_members (project_id, user_id, role)
    select unnest(${projects.map((p) => p.project_id) as string[]}::uuid[]),
           ${subUserId}::uuid,
           'editor'
    on conflict (project_id, user_id) do nothing
  `;

  // ステップ3: sub_accounts に親子関係を記録
  await sql`
    insert into sub_accounts (master_user_id, sub_user_id)
    values (${masterUserId}, ${subUserId})
    on conflict (master_user_id, sub_user_id) do nothing
  `;

  return { subUserId, projectCount: projects.length };
}

/**
 * サブアカウント削除。
 * - auth.users から削除 (cascade で project_members / sub_accounts も消える)
 * - master との関係を確認してから削除 (他人のサブを誤って消さないため)
 */
export async function deleteSubAccount(
  masterUserId: string,
  subAccountId: string,
): Promise<void> {
  const rows = await sql<{ sub_user_id: string }[]>`
    select sub_user_id from sub_accounts
    where id = ${subAccountId} and master_user_id = ${masterUserId}
  `;
  const target = rows[0];
  if (!target) {
    throw new Error("対象のサブアカウントが見つかりません (権限なしの可能性)");
  }

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(target.sub_user_id);
  if (error) {
    throw new Error(`サブアカウント削除失敗: ${error.message}`);
  }
  // sub_accounts は auth.users cascade で消える
}
