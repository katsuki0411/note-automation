-- =========================================================
-- API 連携設定 (Phase 6-A)
-- =========================================================
-- プロジェクト単位 / ユーザー単位の2階層で API キー等を保存する。
-- env からのフォールバックは lib/integrations.ts で実装。
--
-- project_integrations: プロジェクトで切り替えたい API
--   - amazon_associate (トラッキングID / PA-API キー)
--   - a8_net (メディアID / SID)
--
-- user_integrations: 同じユーザーなら共通で良い API (課金統合)
--   - brave_search
--   - gemini
--   - claude
--
-- DB に空 or 未登録なら、利用側で env (BRAVE_SEARCH_API_KEY 等) にフォールバック。
-- =========================================================

-- プロジェクト単位の API 連携
create table if not exists project_integrations (
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (project_id, kind)
);

create index if not exists project_integrations_project_idx
  on project_integrations(project_id);

alter table project_integrations enable row level security;
drop policy if exists "project_member_all" on project_integrations;
create policy "project_member_all" on project_integrations for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid()))
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));

-- ユーザー単位の API 連携
create table if not exists user_integrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table user_integrations enable row level security;
drop policy if exists "owner_all" on user_integrations;
create policy "owner_all" on user_integrations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
