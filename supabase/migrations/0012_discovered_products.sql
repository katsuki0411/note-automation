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
