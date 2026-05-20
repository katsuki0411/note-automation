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
