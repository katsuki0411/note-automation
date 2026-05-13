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
