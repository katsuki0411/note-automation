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
