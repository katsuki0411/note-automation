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
