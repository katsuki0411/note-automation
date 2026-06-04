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
