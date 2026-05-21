-- =========================================================
-- Destination 単位のプロンプト設定 (Phase 3C)
-- =========================================================
-- 目的: 各 posting_destinations 行 (note / はてな / livedoor 等) に
--       記事生成プロンプトを保持させる。設定画面から編集可能にする。
--
-- prompt_config jsonb の項目構造:
--   {
--     role:                string,  // 役割定義 (例: "あなたは...のライターです")
--     authorProfile:       string,  // 著者プロフィール (Markdown OK)
--     audience:            string,  // ターゲット読者の説明
--     tone:                string,  // 文体・トーン (絵文字 / 結論先出し / 共感 等)
--     dos:                 string,  // 必須事項 (1項目1行)
--     donts:               string,  // 禁事項 (1項目1行)
--     structure:           string,  // 構造ルール (H2/H3 / TL;DR / FAQ など)
--     cta:                 string,  // CTA 指示
--     platformConstraints: string,  // プラットフォーム固有制約 (note=24文字タイトル等)
--     customNotes:         string,  // 自由メモ・補足指示
--   }
-- すべての項目はオプショナル。空オブジェクト {} の場合は project.persona_config.kind
-- に応じて fallback (主婦デフォルトテンプレ等) を使う。
-- =========================================================

-- prompt_config 列追加
alter table posting_destinations
  add column if not exists prompt_config jsonb not null default '{}'::jsonb;

-- 既存 syuhu project に platform='note' の destination を投入
-- 既に同じ slug の destination がある場合 (= 再実行) は重複しないようガード
do $$
declare
  syuhu_id uuid;
  owner_id uuid;
begin
  select id into syuhu_id from projects where slug = 'syuhu' limit 1;
  if syuhu_id is null then
    raise notice 'syuhu project が見つからないため note destination 投入をスキップ';
    return;
  end if;

  select user_id into owner_id
  from project_members
  where project_id = syuhu_id and role = 'owner'
  order by created_at asc limit 1;

  if owner_id is null then
    raise exception 'syuhu project の owner が見つかりません';
  end if;

  -- 既に platform='note' の destination が syuhu にあるかチェック
  if not exists (
    select 1 from posting_destinations
    where project_id = syuhu_id and platform = 'note'
  ) then
    insert into posting_destinations (
      project_id, user_id, platform, label, config, enabled, prompt_config
    ) values (
      syuhu_id,
      owner_id,
      'note',
      'note (note.com)',
      '{}'::jsonb,        -- note は Chrome 拡張経由なので接続情報なし
      true,
      '{}'::jsonb         -- 空 → fallback で主婦デフォルトテンプレが当たる
    );
    raise notice '✅ syuhu に note destination を投入しました';
  else
    raise notice '⏭️  syuhu には既に note destination が存在するためスキップ';
  end if;
end $$;
