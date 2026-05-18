-- マルチポスト機能: 投稿先プラットフォームと投稿履歴

-- 投稿先プラットフォーム (note は拡張経由なのでここには登録不要、
-- 公式APIで投稿できるプラットフォーム = hatena / livedoor / blogger / wordpress 等)
create table if not exists posting_destinations (
  id uuid primary key default gen_random_uuid(),
  platform text not null,        -- 'hatena' | 'livedoor' | 'blogger' | 'wordpress' | etc
  label text not null,           -- ユーザーが付ける表示名 (例: "メインブログ")
  config jsonb not null,         -- {hatenaId, blogDomain, apiKey} 等プラットフォーム別の構造
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists posting_destinations_platform_idx
  on posting_destinations (platform);

-- 各記事ごとの投稿履歴: どの記事が、どの宛先に、いつ、成功/失敗で投稿されたか
create table if not exists article_postings (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  destination_id uuid references posting_destinations(id) on delete set null,
  destination_label text not null,  -- destination 削除後も追跡できるよう冗長コピー
  platform text not null,           -- 同上
  status text not null,             -- 'success' | 'failed'
  external_url text,                -- 投稿成功時の公開URL
  error text,                       -- 失敗時のエラーメッセージ
  posted_at timestamptz not null default now()
);

create index if not exists article_postings_article_id_idx
  on article_postings (article_id, posted_at desc);
create index if not exists article_postings_posted_at_idx
  on article_postings (posted_at desc);
