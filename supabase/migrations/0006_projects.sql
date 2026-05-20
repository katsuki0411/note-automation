-- =========================================================
-- マルチプロジェクト対応 (Phase 2): projects / project_members 新設
-- =========================================================
-- 目的: データ分離の主軸を user_id から project_id に変更し、
--       1ユーザーが複数プロジェクトを運用 / 1プロジェクトを複数ユーザーで共同運用
--       という多対多関係を実現する。
--
-- URL 構造: /p/<slug>/...  (例 /p/syuhu, /p/aff)
-- 既存データは全て slug='syuhu' (主婦プロジェクト) に移行。
-- =========================================================

-- ===== STEP 0: 前提チェック =====
do $$
declare
  default_user_id uuid;
begin
  select id into default_user_id
  from auth.users
  where email = 'info@michisu-inc.com'
  limit 1;
  if default_user_id is null then
    raise exception 'デフォルトユーザー info@michisu-inc.com が auth.users に存在しません';
  end if;
end $$;

-- ===== STEP 1: projects テーブル新設 =====
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,             -- URL 識別子 (例 'syuhu', 'aff')
  display_name text not null,            -- 表示名 (例 '主婦のミカタ。アリー')
  persona_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_slug_idx on projects (slug);

-- 主婦プロジェクトを投入 (既存データのコンテナ)
insert into projects (slug, display_name, persona_config)
values (
  'syuhu',
  '主婦のミカタ。アリー',
  jsonb_build_object(
    'kind', 'housewife',
    'author_concept', jsonb_build_array('LINEで送るだけ', '主婦専用', 'AIツールを直接使わせない'),
    'themes', jsonb_build_array('renraku', 'schedule', 'paperwork', 'money'),
    'kgi', 'individual_dev_lead'
  )
)
on conflict (slug) do nothing;

-- ===== STEP 2: project_members テーブル新設 =====
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',    -- 'owner' | 'editor' | 'viewer'
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on project_members (user_id);

-- info@michisu-inc.com を syuhu プロジェクトのオーナーとして登録
insert into project_members (project_id, user_id, role)
select p.id, u.id, 'owner'
from projects p, auth.users u
where p.slug = 'syuhu' and u.email = 'info@michisu-inc.com'
on conflict (project_id, user_id) do nothing;

-- ===== STEP 3: 各データテーブルに project_id 追加 + 既存データ移行 =====

-- ----- articles -----
alter table articles add column if not exists project_id uuid references projects(id) on delete cascade;
update articles set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table articles alter column project_id set not null;
create index if not exists articles_project_created_idx on articles (project_id, created_at desc);

-- ----- ideas -----
alter table ideas add column if not exists project_id uuid references projects(id) on delete cascade;
update ideas set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table ideas alter column project_id set not null;
create index if not exists ideas_project_created_idx on ideas (project_id, created_at desc);

-- ----- hot_keywords -----
alter table hot_keywords add column if not exists project_id uuid references projects(id) on delete cascade;
update hot_keywords set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table hot_keywords alter column project_id set not null;
-- Phase 1 で張った user_id 込みの unique は project_id 中心に張り直す
alter table hot_keywords drop constraint if exists hot_keywords_kw_theme_user_key;
alter table hot_keywords add constraint hot_keywords_kw_theme_project_key unique (kw, theme_id, project_id);
create index if not exists hot_keywords_project_priority_idx on hot_keywords (project_id, priority desc);

-- ----- keywords -----
alter table keywords add column if not exists project_id uuid references projects(id) on delete cascade;
update keywords set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table keywords alter column project_id set not null;
alter table keywords drop constraint if exists keywords_theme_kw_user_key;
alter table keywords add constraint keywords_theme_kw_project_key unique (theme_id, kw, project_id);
create index if not exists keywords_project_idx on keywords (project_id);

-- ----- platforms -----
alter table platforms add column if not exists project_id uuid references projects(id) on delete cascade;
update platforms set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table platforms alter column project_id set not null;
alter table platforms drop constraint if exists platforms_domain_user_key;
alter table platforms add constraint platforms_domain_project_key unique (domain, project_id);
create index if not exists platforms_project_idx on platforms (project_id);

-- ----- seo_targets -----
alter table seo_targets add column if not exists project_id uuid references projects(id) on delete cascade;
update seo_targets set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table seo_targets alter column project_id set not null;
alter table seo_targets drop constraint if exists seo_targets_kw_url_user_key;
alter table seo_targets add constraint seo_targets_kw_url_project_key unique (kw, target_url_prefix, project_id);
create index if not exists seo_targets_project_enabled_idx on seo_targets (project_id) where enabled = true;

-- ----- seo_rankings -----
alter table seo_rankings add column if not exists project_id uuid references projects(id) on delete cascade;
update seo_rankings sr set project_id = st.project_id
  from seo_targets st where sr.target_id = st.id and sr.project_id is null;
alter table seo_rankings alter column project_id set not null;
create index if not exists seo_rankings_project_idx on seo_rankings (project_id, target_id, checked_at desc);

-- ----- posting_destinations -----
alter table posting_destinations add column if not exists project_id uuid references projects(id) on delete cascade;
update posting_destinations set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table posting_destinations alter column project_id set not null;
create index if not exists posting_destinations_project_idx on posting_destinations (project_id);

-- ----- article_postings -----
alter table article_postings add column if not exists project_id uuid references projects(id) on delete cascade;
update article_postings ap set project_id = a.project_id
  from articles a where ap.article_id = a.id and ap.project_id is null;
alter table article_postings alter column project_id set not null;
create index if not exists article_postings_project_idx on article_postings (project_id, posted_at desc);

-- ===== STEP 4: Singleton テーブルを per-project に変更 =====
-- Phase 1 で per-user singleton にしたが、Phase 2 では per-project singleton にする
-- (user_id 列は残すが PK は project_id に張り直す)

-- ----- feed_state -----
alter table feed_state add column if not exists project_id uuid references projects(id) on delete cascade;
update feed_state set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table feed_state alter column project_id set not null;
alter table feed_state drop constraint if exists feed_state_pkey;
alter table feed_state add constraint feed_state_pkey primary key (project_id);

-- ----- hot_keywords_meta -----
alter table hot_keywords_meta add column if not exists project_id uuid references projects(id) on delete cascade;
update hot_keywords_meta set project_id = (select id from projects where slug = 'syuhu') where project_id is null;
alter table hot_keywords_meta alter column project_id set not null;
alter table hot_keywords_meta drop constraint if exists hot_keywords_meta_pkey;
alter table hot_keywords_meta add constraint hot_keywords_meta_pkey primary key (project_id);

-- ===== STEP 5: profiles テーブルは保留 =====
-- Phase 1 で作った profiles は persona_config を持っていたが、
-- ペルソナはプロジェクト単位に持つようにしたので冗長。
-- ただし「ユーザー個人の表示名/設定」用に残せる余地はあるので drop せず置いておく。

-- ===== STEP 6: RLS policy を project_members ベースに更新 =====
-- 旧 owner_all policy (user_id = auth.uid()) を捨てて、
-- 自分が member の project のみ操作可能 policy に張り直す。

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'articles', 'ideas', 'hot_keywords', 'keywords', 'platforms',
      'seo_targets', 'seo_rankings', 'posting_destinations',
      'article_postings', 'feed_state', 'hot_keywords_meta'
    ])
  loop
    execute format('drop policy if exists "owner_all" on %I', t);
    execute format(
      'create policy "project_member_all" on %I for all to authenticated '
      || 'using (project_id in (select project_id from project_members where user_id = auth.uid())) '
      || 'with check (project_id in (select project_id from project_members where user_id = auth.uid()))',
      t
    );
  end loop;
end $$;

-- projects 自体 + project_members の RLS
alter table projects enable row level security;
drop policy if exists "owner_all" on projects;
drop policy if exists "member_select" on projects;
create policy "member_select" on projects for select to authenticated
  using (id in (select project_id from project_members where user_id = auth.uid()));
-- projects への insert/update/delete はオーナーだけ
drop policy if exists "owner_write" on projects;
create policy "owner_write" on projects for all to authenticated
  using (id in (select project_id from project_members where user_id = auth.uid() and role = 'owner'))
  with check (id in (select project_id from project_members where user_id = auth.uid() and role = 'owner'));

alter table project_members enable row level security;
drop policy if exists "owner_all" on project_members;
drop policy if exists "self_or_owner_select" on project_members;
create policy "self_or_owner_select" on project_members for select to authenticated
  using (
    user_id = auth.uid()
    or project_id in (select project_id from project_members where user_id = auth.uid() and role = 'owner')
  );
drop policy if exists "owner_manage_members" on project_members;
create policy "owner_manage_members" on project_members for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid() and role = 'owner'))
  with check (project_id in (select project_id from project_members where user_id = auth.uid() and role = 'owner'));
