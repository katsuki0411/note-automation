-- =========================================================
-- 執筆者ペルソナ 構造化フィールド (Phase 2, 2026-06-27)
-- =========================================================
-- 0018 では body(自由記述1フィールド)のみだったが、3段プロンプトの共通仕様B
-- (writer_name / writer_title / writer_expertise / ... の12項目) に1:1注入できるよう
-- 構造化フィールドを fields jsonb として追加する。
--   fields = { title, expertise, achievements, firstPerson, tone, values,
--              episodes, vocab, ng, profileUrl, photoUrl }
--   ※ writer_name は既存の name カラムを流用。
--   ※ body は「その他補足(自由記述)」として残し、構造化フィールドと併用可。
-- 加算的変更 (既存レコードは fields={} で無害)。
-- =========================================================

alter table author_personas
  add column if not exists fields jsonb not null default '{}'::jsonb;
