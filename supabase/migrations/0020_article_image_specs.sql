-- =========================================================
-- 記事の本文画像指示 (2026-07-01)
-- =========================================================
-- フェーズ3の出力に含まれる「③画像生成指示」ブロック (本文中の [IMG-NN] マーカー
-- ごとの marker / placement / aspect_ratio / prompt / negative / altText 等) を
-- 構造化して保持する。従来はパース時に破棄していた。
--   image_specs = [{ marker, role, placement, purpose, type, aspectRatio,
--                    style, textInImage, prompt, negative, altText }, ...]
-- 加算的変更 (既存レコードは [] で無害。旧記事は本文の [IMG] マーカーのみ残る)。
-- =========================================================

alter table articles
  add column if not exists image_specs jsonb not null default '[]'::jsonb;
