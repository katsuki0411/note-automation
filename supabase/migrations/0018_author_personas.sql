-- =========================================================
-- 執筆者ペルソナ ライブラリ (2026-06-25)
-- =========================================================
-- 各投稿先 (destination) の記事生成に使う「執筆者の人格」を定義するライブラリ。
-- 1つ作って複数媒体に割り当てられる共通ライブラリ方式。
-- body は自由記述 1フィールド (「あなたは35歳、2児を育てる元保育士のブロガー…」)。
-- destination 側は prompt_config.personaId でこのテーブルの id を参照する。
-- 記事生成時 (/api/generate) は body を system プロンプトに注入する。
-- =========================================================

create table if not exists author_personas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 一覧 (project内、新しい順)
create index if not exists author_personas_project_created_idx
  on author_personas (project_id, created_at desc);

-- RLS (他テーブルと同じ project_members ベース)
alter table author_personas enable row level security;
drop policy if exists "project_member_all" on author_personas;
create policy "project_member_all" on author_personas for all to authenticated
  using (project_id in (select project_id from project_members where user_id = auth.uid()))
  with check (project_id in (select project_id from project_members where user_id = auth.uid()));
