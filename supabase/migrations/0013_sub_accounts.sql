-- =========================================================
-- サブアカウント (Phase 7-A)
-- =========================================================
-- マスター(env MASTER_USER_EMAIL で指定)がスタッフ用ログインを発行する機能。
-- auth.users に対して「誰が誰を作成したか」を追跡するためのテーブル。
--
-- project_members は別途自動登録される (マスターの全プロジェクトに editor として)。
-- このテーブルは「マスター ⇔ 自分が発行したサブ」を結ぶだけの台帳。
-- =========================================================

create table if not exists sub_accounts (
  id uuid primary key default gen_random_uuid(),
  master_user_id uuid not null references auth.users(id) on delete cascade,
  sub_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 1人のマスターに1サブの組み合わせは1度だけ
alter table sub_accounts
  drop constraint if exists sub_accounts_master_sub_key;
alter table sub_accounts
  add constraint sub_accounts_master_sub_key
    unique (master_user_id, sub_user_id);

create index if not exists sub_accounts_master_idx
  on sub_accounts (master_user_id);

-- RLS: 自分が master なレコードだけ見える
alter table sub_accounts enable row level security;
drop policy if exists "master_sees_own" on sub_accounts;
create policy "master_sees_own" on sub_accounts for all to authenticated
  using (master_user_id = auth.uid())
  with check (master_user_id = auth.uid());
