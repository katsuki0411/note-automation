-- 投稿レコード機能: note へ投稿した日時を articles に記録する
alter table articles
  add column if not exists posted_at timestamptz;

-- 投稿レコード一覧で created_at 降順表示するためのインデックス
create index if not exists articles_posted_at_idx
  on articles (posted_at desc)
  where posted_at is not null;
