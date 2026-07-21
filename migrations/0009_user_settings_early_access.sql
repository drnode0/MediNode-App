-- 先行体験（マルチ部署串刺し検索）の開放フラグ。
-- アカウント単位の口座属性（契約有無に依存しない）ため user_settings に置く。
-- 追加のみ・既存データに影響なし。コードは列が無くても動く（照会失敗時は false 扱い）ため、
-- 0006/0007/0008 と同様に Supabase SQL Editor で任意のタイミングで適用してよい。
alter table public.user_settings
  add column if not exists early_access boolean not null default false;
