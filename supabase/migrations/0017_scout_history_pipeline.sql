-- =========================================================
-- 商品スカウト履歴: パイプライン段階の追跡データを永続化
-- =========================================================
-- これまで履歴テーブルは「最終候補 (candidates)」しか保存していなかったが、
-- UI で ①Gemini #1 全候補 / ②Stage 3通過 / ③Stage 5通過 / ④Stage 7採用 を
-- 段階ごとに見られるようにしたため、Stage 1〜5 で落選した KW と各段階の
-- 通過件数も保存できるようにする。
--
-- - rejected_candidates: Stage 1 で生成されたが Stage 3/5 で落選した KW
--   ScoutAllCandidate[] (kw / intent / reason / stage / kd / sv / cpc /
--   competitionLevel / searchIntent / rejectionNote)
-- - pipeline_stats: 各段階の通過件数
--   ScoutStats (stage1Generated / stage3PassedKd / stage5PassedMetrics /
--   finalCount / adoptedCount)
-- =========================================================

alter table product_scout_history
  add column if not exists rejected_candidates jsonb not null default '[]'::jsonb;

alter table product_scout_history
  add column if not exists pipeline_stats jsonb;
