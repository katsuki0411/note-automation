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
