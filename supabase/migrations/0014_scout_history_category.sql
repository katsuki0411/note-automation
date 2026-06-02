-- =========================================================
-- product_scout_history にカテゴリ列追加 (2026-06-02)
-- =========================================================
-- スカウト履歴をジャンル別にフィルタするための列。
-- スカウト実行時に Gemini で subject から推定して入れる。
-- 既存履歴は NULL (= 未分類) のまま。
-- =========================================================

alter table product_scout_history
  add column if not exists category text;

create index if not exists product_scout_history_project_category_idx
  on product_scout_history (project_id, category);
