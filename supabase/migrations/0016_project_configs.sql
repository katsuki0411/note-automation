-- 2026-06-09: プロジェクト単位の設定 (拡張プラン B' + 3段プロンプト記事生成)
--
-- scout_config: KWスカウト パイプライン用 (除外KW / 閾値 / Gemini 4段プロンプト)
-- article_gen_config: 記事生成用 (3段プロンプトチェーン)
--
-- どちらも jsonb で柔軟に。スキーマは TypeScript 側 (lib/projectConfigs.ts) で
-- 定義する方針。

alter table projects
  add column if not exists scout_config jsonb not null default '{}'::jsonb;

alter table projects
  add column if not exists article_gen_config jsonb not null default '{}'::jsonb;

-- スコア計算高速化: 設定読み込みは project_id 1件取得のみなので
-- 既存 PK インデックスで十分。追加インデックスなし。
