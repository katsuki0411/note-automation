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
