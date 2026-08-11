-- 登録フローで訊く職種（アカウント属性）。CQ_OCCUPATIONS の固定リストの値のみが入る。
-- 既存migration（0009等）と同様、列が無くてもコードは動く（照会失敗時は null 扱い）ため、
-- Supabase SQL Editor で任意のタイミングで適用してよい。追加のみ・既存データに影響なし。
-- 適用前は登録フローの職種ステップが保存なしのスキップ相当で動く（保存されるのは適用後）。
alter table public.user_settings
  add column if not exists occupation text;
