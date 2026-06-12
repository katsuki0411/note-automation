-- ===========================================
-- note 自動化システム DB スキーマ統合版
-- 全 17 migrations を順次実行 (新規プロジェクトのSQL Editorで1回貼付・実行)
-- ===========================================

-- ==========================================
-- 0001_initial.sql
-- ==========================================
-- =========================================================
-- note自動化システム · 初期スキーマ
-- =========================================================

-- Articles: 生成された記事
create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  idea jsonb not null,
  best_title text not null,
  title_candidates jsonb not null default '[]'::jsonb,
  best_title_reason text default '',
  body_markdown text not null default '',
  image_prompt_subject text default '',
  image_alt_text text default '',
  image_path text
);
create index if not exists articles_created_at_idx on articles (created_at desc);

-- Ideas: ライブネタフィード
create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  theme_id text not null,
  custom_label text,
  source_mode text,
  title text not null,
  hook text default '',
  angle text default '',
  trend_source text,
  voice jsonb,
  tool_concept text,
  keywords jsonb,
  target jsonb,
  impression jsonb,
  priority_score integer,
  target_keyword_id uuid
);
create index if not exists ideas_created_at_idx on ideas (created_at desc);
create index if not exists ideas_theme_idx on ideas (theme_id);

-- Hot Keywords: 発掘された主婦向けホットキーワード
create table if not exists hot_keywords (
  id uuid primary key default gen_random_uuid(),
  kw text not null,
  theme_id text not null,
  volume_hint text not null default 'medium',
  competition_hint text not null default 'medium',
  rise_status text not null default 'stable',
  intent text not null default 'trouble',
  priority integer not null default 50,
  pain_intensity integer not null default 3,
  why_hot text default '',
  sources jsonb default '[]'::jsonb,
  discovered_at timestamptz not null default now(),
  verified_hits integer,
  verified_at timestamptz,
  verify_status text,
  sample_urls jsonb,
  unique(kw, theme_id)
);
create index if not exists hot_kw_priority_idx on hot_keywords (priority desc);

-- Hot Keywords metadata（最終発掘日時と検証統計のキャッシュ）
create table if not exists hot_keywords_meta (
  id integer primary key default 1,
  updated_at timestamptz,
  stats jsonb,
  constraint hot_kw_meta_singleton check (id = 1)
);

-- Keywords: KW辞書
create table if not exists keywords (
  id uuid primary key default gen_random_uuid(),
  theme_id text not null,
  subcategory_id text not null,
  kw text not null,
  intent text not null default 'trouble',
  vol text not null default 'medium',
  comp text not null default 'medium',
  priority integer not null default 50,
  memo text default '',
  status text not null default 'untargeted',
  article_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(theme_id, kw)
);

-- Platforms: 検索許可ドメイン
create table if not exists platforms (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  label text not null,
  category text not null default 'other',
  enabled boolean not null default true,
  is_default boolean default false,
  memo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Feed state: tick回数の累積カウント等（singleton）
create table if not exists feed_state (
  id integer primary key default 1,
  tick_count integer not null default 0,
  last_tick_at timestamptz,
  constraint feed_state_singleton check (id = 1)
);

-- Singletonの初期行を作成
insert into feed_state (id, tick_count) values (1, 0) on conflict (id) do nothing;
insert into hot_keywords_meta (id) values (1) on conflict (id) do nothing;


-- ==========================================
-- 0002_seo_rankings.sql
-- ==========================================
-- =========================================================
-- SEO順位追跡機能 · 追加スキーマ
-- =========================================================

-- SEO Targets: 順位追跡対象（キーワード×URL前方一致パターン）
create table if not exists seo_targets (
  id uuid primary key default gen_random_uuid(),
  kw text not null,
  target_url_prefix text not null,
  memo text default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kw, target_url_prefix)
);
create index if not exists seo_targets_enabled_idx on seo_targets (enabled) where enabled = true;

-- SEO Rankings: 順位履歴（圏外は rank=null）
create table if not exists seo_rankings (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references seo_targets(id) on delete cascade,
  rank integer,
  found_url text,
  total_scanned integer not null default 0,
  checked_at timestamptz not null default now(),
  error text
);
create index if not exists seo_rankings_target_idx on seo_rankings (target_id, checked_at desc);


-- ==========================================
-- 0003_articles_posted_at.sql
-- ==========================================
-- 投稿レコード機能: note へ投稿した日時を articles に記録する
alter table articles
  add column if not exists posted_at timestamptz;

-- 投稿レコード一覧で created_at 降順表示するためのインデックス
create index if not exists articles_posted_at_idx
  on articles (posted_at desc)
  where posted_at is not null;


-- ==========================================
-- 0004_posting_destinations.sql
-- ==========================================
-- マルチポスト機能: 投稿先プラットフォームと投稿履歴

-- 投稿先プラットフォーム (note は拡張経由なのでここには登録不要、
-- 公式APIで投稿できるプラットフォーム = hatena / livedoor / blogger / wordpress 等)
create table if not exists posting_destinations (
  id uuid primary key default gen_random_uuid(),
  platform text not null,        -- 'hatena' | 'livedoor' | 'blogger' | 'wordpress' | etc
  label text not null,           -- ユーザーが付ける表示名 (例: "メインブログ")
  config jsonb not null,         -- {hatenaId, blogDomain, apiKey} 等プラットフォーム別の構造
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists posting_destinations_platform_idx
  on posting_destinations (platform);

-- 各記事ごとの投稿履歴: どの記事が、どの宛先に、いつ、成功/失敗で投稿されたか
create table if not exists article_postings (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  destination_id uuid references posting_destinations(id) on delete set null,
  destination_label text not null,  -- destination 削除後も追跡できるよう冗長コピー
  platform text not null,           -- 同上
  status text not null,             -- 'success' | 'failed'
  external_url text,                -- 投稿成功時の公開URL
  error text,                       -- 失敗時のエラーメッセージ
  posted_at timestamptz not null default now()
);

create index if not exists article_postings_article_id_idx
  on article_postings (article_id, posted_at desc);
create index if not exists article_postings_posted_at_idx
  on article_postings (posted_at desc);


-- ==========================================
-- 0005_user_isolation.sql
-- ==========================================
-- =========================================================
-- マルチユーザー対応 (Phase 1): 全テーブルに user_id を追加
-- =========================================================
-- 目的: 「ログインユーザー = 完全に独立したペルソナ」として
--       全データをユーザー単位で物理分離する。
--
-- 既存データの扱い: 全行を info@michisu-inc.com (主婦アカウント) に紐付け。
--
-- 注意:
--   - アプリは postgres (スーパーユーザー) で接続するため RLS は素通り。
--     よってアプリ側で WHERE user_id = ? を全クエリに追加する必要がある (次セッション)。
--   - RLS policy は二重防御として有効化 (将来 anon キー経由のアクセスに備える)。
-- =========================================================

-- ===== STEP 0: デフォルトユーザーIDが存在することを確認 =====
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
  raise notice '✅ default_user_id = %', default_user_id;
end $$;

-- ===== STEP 1: profiles テーブル新設 =====
-- ユーザー別のペルソナ設定 (Phase 2 でプロンプト構築に使う)
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  persona_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- michisu.inc 用 profile を投入
insert into profiles (user_id, display_name, persona_config)
select id, '主婦のミカタ。アリー',
       jsonb_build_object(
         'kind', 'housewife',
         'author_concept', jsonb_build_array('LINEで送るだけ', '主婦専用', 'AIツールを直接使わせない'),
         'themes', jsonb_build_array('renraku', 'schedule', 'paperwork', 'money')
       )
from auth.users where email = 'info@michisu-inc.com'
on conflict (user_id) do nothing;

-- ===== STEP 2: 各データテーブルに user_id を追加 + 既存データ移行 =====

-- ----- articles -----
alter table articles add column if not exists user_id uuid references auth.users(id) on delete cascade;
update articles set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table articles alter column user_id set not null;
create index if not exists articles_user_created_idx on articles (user_id, created_at desc);

-- ----- ideas -----
alter table ideas add column if not exists user_id uuid references auth.users(id) on delete cascade;
update ideas set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table ideas alter column user_id set not null;
create index if not exists ideas_user_created_idx on ideas (user_id, created_at desc);

-- ----- hot_keywords -----
alter table hot_keywords add column if not exists user_id uuid references auth.users(id) on delete cascade;
update hot_keywords set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table hot_keywords alter column user_id set not null;
-- 別ユーザーは同じ kw/theme を持てるよう unique を user_id 込みに差し替え
alter table hot_keywords drop constraint if exists hot_keywords_kw_theme_id_key;
alter table hot_keywords add constraint hot_keywords_kw_theme_user_key unique (kw, theme_id, user_id);
create index if not exists hot_keywords_user_priority_idx on hot_keywords (user_id, priority desc);

-- ----- keywords -----
alter table keywords add column if not exists user_id uuid references auth.users(id) on delete cascade;
update keywords set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table keywords alter column user_id set not null;
alter table keywords drop constraint if exists keywords_theme_id_kw_key;
alter table keywords add constraint keywords_theme_kw_user_key unique (theme_id, kw, user_id);
create index if not exists keywords_user_idx on keywords (user_id);

-- ----- platforms -----
alter table platforms add column if not exists user_id uuid references auth.users(id) on delete cascade;
update platforms set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table platforms alter column user_id set not null;
alter table platforms drop constraint if exists platforms_domain_key;
alter table platforms add constraint platforms_domain_user_key unique (domain, user_id);
create index if not exists platforms_user_idx on platforms (user_id);

-- ----- seo_targets -----
alter table seo_targets add column if not exists user_id uuid references auth.users(id) on delete cascade;
update seo_targets set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table seo_targets alter column user_id set not null;
alter table seo_targets drop constraint if exists seo_targets_kw_target_url_prefix_key;
alter table seo_targets add constraint seo_targets_kw_url_user_key unique (kw, target_url_prefix, user_id);
create index if not exists seo_targets_user_enabled_idx on seo_targets (user_id) where enabled = true;

-- ----- seo_rankings (parent: seo_targets) -----
alter table seo_rankings add column if not exists user_id uuid references auth.users(id) on delete cascade;
update seo_rankings sr set user_id = st.user_id
  from seo_targets st where sr.target_id = st.id and sr.user_id is null;
alter table seo_rankings alter column user_id set not null;
create index if not exists seo_rankings_user_target_idx on seo_rankings (user_id, target_id, checked_at desc);

-- ----- posting_destinations -----
alter table posting_destinations add column if not exists user_id uuid references auth.users(id) on delete cascade;
update posting_destinations set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table posting_destinations alter column user_id set not null;
create index if not exists posting_destinations_user_idx on posting_destinations (user_id);

-- ----- article_postings (parent: articles) -----
alter table article_postings add column if not exists user_id uuid references auth.users(id) on delete cascade;
update article_postings ap set user_id = a.user_id
  from articles a where ap.article_id = a.id and ap.user_id is null;
alter table article_postings alter column user_id set not null;
create index if not exists article_postings_user_idx on article_postings (user_id, posted_at desc);

-- ===== STEP 3: Singleton テーブルを per-user singleton に変更 =====
-- 既存の id=1 制約はやめて、user_id を PK にする。

-- ----- feed_state -----
alter table feed_state add column if not exists user_id uuid references auth.users(id) on delete cascade;
update feed_state set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table feed_state alter column user_id set not null;
alter table feed_state drop constraint if exists feed_state_singleton;
alter table feed_state drop constraint if exists feed_state_pkey;
alter table feed_state add constraint feed_state_pkey primary key (user_id);
alter table feed_state drop column if exists id;

-- ----- hot_keywords_meta -----
alter table hot_keywords_meta add column if not exists user_id uuid references auth.users(id) on delete cascade;
update hot_keywords_meta set user_id = (select id from auth.users where email = 'info@michisu-inc.com')
  where user_id is null;
alter table hot_keywords_meta alter column user_id set not null;
alter table hot_keywords_meta drop constraint if exists hot_kw_meta_singleton;
alter table hot_keywords_meta drop constraint if exists hot_keywords_meta_pkey;
alter table hot_keywords_meta add constraint hot_keywords_meta_pkey primary key (user_id);
alter table hot_keywords_meta drop column if exists id;

-- ===== STEP 4: RLS 有効化 + policy (二重防御) =====
-- アプリは postgres ロール = RLS バイパスなので機能には影響しない。
-- 将来 anon/authenticated ロール経由でアクセスする場合の安全網。

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'articles', 'ideas', 'hot_keywords', 'keywords', 'platforms',
      'seo_targets', 'seo_rankings', 'posting_destinations',
      'article_postings', 'feed_state', 'hot_keywords_meta', 'profiles'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner_all" on %I', t);
    execute format(
      'create policy "owner_all" on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;


-- ==========================================
-- 0006_projects.sql
-- ==========================================
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


-- ==========================================
-- 0007_destination_prompts.sql
-- ==========================================
-- =========================================================
-- Destination 単位のプロンプト設定 (Phase 3C)
-- =========================================================
-- 目的: 各 posting_destinations 行 (note / はてな / livedoor 等) に
--       記事生成プロンプトを保持させる。設定画面から編集可能にする。
--
-- prompt_config jsonb の項目構造:
--   {
--     role:                string,  // 役割定義 (例: "あなたは...のライターです")
--     authorProfile:       string,  // 著者プロフィール (Markdown OK)
--     audience:            string,  // ターゲット読者の説明
--     tone:                string,  // 文体・トーン (絵文字 / 結論先出し / 共感 等)
--     dos:                 string,  // 必須事項 (1項目1行)
--     donts:               string,  // 禁事項 (1項目1行)
--     structure:           string,  // 構造ルール (H2/H3 / TL;DR / FAQ など)
--     cta:                 string,  // CTA 指示
--     platformConstraints: string,  // プラットフォーム固有制約 (note=24文字タイトル等)
--     customNotes:         string,  // 自由メモ・補足指示
--   }
-- すべての項目はオプショナル。空オブジェクト {} の場合は project.persona_config.kind
-- に応じて fallback (主婦デフォルトテンプレ等) を使う。
-- =========================================================

-- prompt_config 列追加
alter table posting_destinations
  add column if not exists prompt_config jsonb not null default '{}'::jsonb;

-- 既存 syuhu project に platform='note' の destination を投入
-- 既に同じ slug の destination がある場合 (= 再実行) は重複しないようガード
do $$
declare
  syuhu_id uuid;
  owner_id uuid;
begin
  select id into syuhu_id from projects where slug = 'syuhu' limit 1;
  if syuhu_id is null then
    raise notice 'syuhu project が見つからないため note destination 投入をスキップ';
    return;
  end if;

  select user_id into owner_id
  from project_members
  where project_id = syuhu_id and role = 'owner'
  order by created_at asc limit 1;

  if owner_id is null then
    raise exception 'syuhu project の owner が見つかりません';
  end if;

  -- 既に platform='note' の destination が syuhu にあるかチェック
  if not exists (
    select 1 from posting_destinations
    where project_id = syuhu_id and platform = 'note'
  ) then
    insert into posting_destinations (
      project_id, user_id, platform, label, config, enabled, prompt_config
    ) values (
      syuhu_id,
      owner_id,
      'note',
      'note (note.com)',
      '{}'::jsonb,        -- note は Chrome 拡張経由なので接続情報なし
      true,
      '{}'::jsonb         -- 空 → fallback で主婦デフォルトテンプレが当たる
    );
    raise notice '✅ syuhu に note destination を投入しました';
  else
    raise notice '⏭️  syuhu には既に note destination が存在するためスキップ';
  end if;
end $$;


-- ==========================================
-- 0008_project_kind.sql
-- ==========================================
-- =========================================================
-- projects.kind 列追加: プロジェクトの業務フロー種別 (Phase 5-1)
-- =========================================================
-- kind の値:
--   research_based  : 情報源 (知恵袋等) から悩みネタを抽出して記事化する従来型
--   amazon_affiliate: Amazon 商品起点で紹介・レビュー記事を書く
--   a8_affiliate    : A8.net 案件起点でアフィリエイト記事を書く
-- 既存:
--   syuhu -> research_based
--   aff   -> amazon_affiliate
-- =========================================================

alter table projects
  add column if not exists kind text not null default 'research_based';

-- check 制約: 不正値を弾く
alter table projects
  drop constraint if exists projects_kind_check;
alter table projects
  add constraint projects_kind_check
    check (kind in ('research_based', 'amazon_affiliate', 'a8_affiliate'));

-- 既存データの振り分け
update projects set kind = 'research_based'  where slug = 'syuhu' and kind <> 'research_based';
update projects set kind = 'amazon_affiliate' where slug = 'aff'   and kind <> 'amazon_affiliate';

-- 確認用 NOTICE
do $$
declare
  r record;
begin
  for r in select slug, display_name, kind from projects order by created_at loop
    raise notice '✅ project: % (%) → kind=%', r.slug, r.display_name, r.kind;
  end loop;
end $$;


-- ==========================================
-- 0009_bestseller_products.sql
-- ==========================================
-- =========================================================
-- Amazon ベストセラー商品データ (Phase 5-2-B)
-- =========================================================
-- amazon_affiliate / a8_affiliate プロジェクトで、カテゴリ別の Amazon
-- ベストセラー TOP10 を保存するテーブル。日次バッチで refresh する想定。
-- 取得方法は source_used 列で識別 ('scrape' / 'pa-api')。
-- =========================================================

create table if not exists bestseller_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,             -- カテゴリ ID (electronics / kitchen / books / etc)
  rank integer not null,              -- 1〜10
  title text not null,
  url text not null,                  -- Amazon 商品ページの URL
  asin text not null,                 -- Amazon Standard Identification Number (10桁英数字)
  image_url text,                     -- 商品画像 URL (NULLABLE)
  source_used text not null default 'scrape',  -- 'scrape' | 'pa-api'
  fetched_at timestamptz not null default now()
);

-- (project_id, category, asin) で upsert できるよう unique
alter table bestseller_products
  drop constraint if exists bestseller_products_proj_cat_asin_key;
alter table bestseller_products
  add constraint bestseller_products_proj_cat_asin_key
    unique (project_id, category, asin);

create index if not exists bestseller_products_project_category_rank_idx
  on bestseller_products (project_id, category, rank);

create index if not exists bestseller_products_project_fetched_idx
  on bestseller_products (project_id, fetched_at desc);

-- RLS (Phase 2 と同じ project_members ベース)
alter table bestseller_products enable row level security;
drop policy if exists "project_member_all" on bestseller_products;
create policy "project_member_all" on bestseller_products for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid()))
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));


-- ==========================================
-- 0010_product_scout_history.sql
-- ==========================================
-- =========================================================
-- 商品スカウト履歴 (Phase 5-3-A)
-- =========================================================
-- /products 画面で実行した「商品スカウト」の結果を保存する履歴テーブル。
-- subject (商品名/お題) ごとに別レコードとして時系列で残し、後から見直せるようにする。
-- candidates JSONB には ScoutCandidate[] 構造をそのまま入れる
-- (kw / intent / seoDifficulty / opportunityScore / ai 五軸 / destinationStatus 等)。
-- =========================================================

create table if not exists product_scout_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  candidate_count integer not null default 0,
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 一覧 (project内、新しい順) を効率的に取れるよう
create index if not exists product_scout_history_project_created_idx
  on product_scout_history (project_id, created_at desc);

-- RLS (他テーブルと同じ project_members ベース)
alter table product_scout_history enable row level security;
drop policy if exists "project_member_all" on product_scout_history;
create policy "project_member_all" on product_scout_history for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid()))
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));


-- ==========================================
-- 0011_integrations.sql
-- ==========================================
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


-- ==========================================
-- 0012_discovered_products.sql
-- ==========================================
-- =========================================================
-- 商品リサーチ - 発掘商品プール (Phase 6-B)
-- =========================================================
-- /research の各タブ (ベストセラー / 売れ筋 / 新着 / セール / 高評価 / 検索) で取得した
-- 商品を一元保存。各商品に収益化スコアを算出して並べ替え可能にする。
--
-- 既存の bestseller_products は段階的に discovered_products に統合予定。
-- 当面は併存させ、UI 側でこのテーブルを参照する形に移行する。
--
-- score_* 列は productScoring.ts で算出される値:
--   - score_revenue:    紹介料率 × 価格 → 1件あたり期待報酬
--   - score_popularity: log(レビュー数) × ★平均評価
--   - score_seo:        1 / SEO競合度 (スカウト連携で算出、0-100)
--   - score_total:      上記の総合 (内訳プルダウンで表示)
-- =========================================================

create table if not exists discovered_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,                       -- 'bestseller' | 'topsell' | 'new_release' | 'deal' | 'highly_rated' | 'search'
  category text,
  asin text not null,
  title text not null,
  url text not null,
  image_url text,

  -- 商品メタ (PA-API 取得後に埋まる。Mock では仮値)
  price integer,                              -- 円
  rating numeric(3,2),                        -- 1.00 - 5.00
  review_count integer,
  fees_rate numeric(5,4),                     -- 0.0300 = 3%

  -- 算出済スコア (UI ソート用にカラム化)
  score_revenue numeric(10,2),
  score_popularity numeric(10,2),
  score_seo numeric(10,2),
  score_total numeric(10,2),

  scouted_at timestamptz,                     -- 最終 SEO スカウト日時
  posted boolean not null default false,      -- 自分が既に記事化したか
  source_used text not null default 'mock',   -- 'mock' | 'scrape' | 'pa-api'
  fetched_at timestamptz not null default now()
);

-- (project_id, source, asin) で upsert
alter table discovered_products
  drop constraint if exists discovered_products_proj_source_asin_key;
alter table discovered_products
  add constraint discovered_products_proj_source_asin_key
    unique (project_id, source, asin);

create index if not exists discovered_products_project_source_idx
  on discovered_products (project_id, source);

create index if not exists discovered_products_project_score_idx
  on discovered_products (project_id, score_total desc nulls last);

-- RLS (他テーブルと同じ project_members ベース)
alter table discovered_products enable row level security;
drop policy if exists "project_member_all" on discovered_products;
create policy "project_member_all" on discovered_products for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid()))
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));


-- ==========================================
-- 0013_sub_accounts.sql
-- ==========================================
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


-- ==========================================
-- 0014_scout_history_category.sql
-- ==========================================
-- =========================================================
-- product_scout_history にカテゴリ列追加 (2026-06-02)
-- =========================================================
-- スカウト履歴をジャンル別にフィルタするための列。
-- スカウト実行時に Gemini で subject から推定して入れる。
-- 既存履歴は NULL (= 未分類) のまま。
-- =========================================================

alter table product_scout_history
  add column if not exists category text;

create index if not exists product_scout_history_project_category_idx
  on product_scout_history (project_id, category);


-- ==========================================
-- 0015_article_destination_id.sql
-- ==========================================
-- ライブラリ UI 再構成: 1 記事 = 1 destination 用に生成 へ仕様変更
-- 同じKWでもサイトごとに別記事を生成・管理できるよう、articles に destination_id を持たせる。
--
-- 既存記事は note 中心の運用だったため、各プロジェクトの platform='note' の
-- posting_destinations.id でバックフィルする (回答A)。

alter table articles
  add column if not exists destination_id uuid
    references posting_destinations(id) on delete set null;

-- 既存記事を note destination にバックフィル
-- 各 project の platform='note' destination を参照
update articles a
   set destination_id = pd.id
  from posting_destinations pd
 where a.destination_id is null
   and pd.project_id = a.project_id
   and pd.platform = 'note';

-- (project に note destination が無い場合は NULL のまま残るが、
--  0007 マイグレーションで syuhu project には自動投入済み。
--  以降に作られた project でも /api/projects POST 側で note destination を作る方針)

create index if not exists articles_destination_idx
  on articles (destination_id);
create index if not exists articles_project_destination_idx
  on articles (project_id, destination_id);


-- ==========================================
-- 0016_project_configs.sql
-- ==========================================
-- 2026-06-09: プロジェクト単位の設定 (拡張プラン B' + 3段プロンプト記事生成)
--
-- scout_config: KWスカウト パイプライン用 (除外KW / 閾値 / Gemini 4段プロンプト)
-- article_gen_config: 記事生成用 (3段プロンプトチェーン)
--
-- どちらも jsonb で柔軟に。スキーマは TypeScript 側 (lib/projectConfigs.ts) で
-- 定義する方針。

alter table projects
  add column if not exists scout_config jsonb not null default '{}'::jsonb;

alter table projects
  add column if not exists article_gen_config jsonb not null default '{}'::jsonb;

-- スコア計算高速化: 設定読み込みは project_id 1件取得のみなので
-- 既存 PK インデックスで十分。追加インデックスなし。


-- ==========================================
-- 0017_scout_history_pipeline.sql
-- ==========================================
-- =========================================================
-- 商品スカウト履歴: パイプライン段階の追跡データを永続化
-- =========================================================
-- これまで履歴テーブルは「最終候補 (candidates)」しか保存していなかったが、
-- UI で ①Gemini #1 全候補 / ②Stage 3通過 / ③Stage 5通過 / ④Stage 7採用 を
-- 段階ごとに見られるようにしたため、Stage 1〜5 で落選した KW と各段階の
-- 通過件数も保存できるようにする。
--
-- - rejected_candidates: Stage 1 で生成されたが Stage 3/5 で落選した KW
--   ScoutAllCandidate[] (kw / intent / reason / stage / kd / sv / cpc /
--   competitionLevel / searchIntent / rejectionNote)
-- - pipeline_stats: 各段階の通過件数
--   ScoutStats (stage1Generated / stage3PassedKd / stage5PassedMetrics /
--   finalCount / adoptedCount)
-- =========================================================

alter table product_scout_history
  add column if not exists rejected_candidates jsonb not null default '[]'::jsonb;

alter table product_scout_history
  add column if not exists pipeline_stats jsonb;


