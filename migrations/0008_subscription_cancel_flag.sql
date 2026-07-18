-- 解約予約（Stripe cancel_at_period_end）の保存列。
-- 「解約手続き済みだが期間末までは利用可能」をアプリ内に表示するために使う。
-- 追加のみ・既存データに影響なし。コードは列が無くても動く（フォールバックあり）ため、
-- 0006/0007 と同様に Supabase SQL Editor で任意のタイミングで適用してよい。
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;
