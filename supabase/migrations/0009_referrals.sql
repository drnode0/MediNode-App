-- MediNode 友達紹介（常設）
-- ============================================================================
-- 各ユーザーに個人紹介コード（例: MN-K3F7WXQZ）を発行し、友達が既存の
-- コード入力欄でそれを使うと、新規側 30日トライアル・紹介者 +14日 を付与する。
--   - referral_codes       : ユーザー1人につき1コード（設定画面の初回表示時に発行）
--   - referral_redemptions : 「誰が誰を紹介したか」の成立記録。
--       referred_user_id UNIQUE で「紹介特典の受け取りは1アカウント生涯1回」を
--       DBレベルで保証する（アプリ側の検証はこの制約の前段の親切表示にすぎない）。
-- 付与そのもの（subscriptions への書き込み・Stripe請求の後ろ倒し）はサーバーが行い、
-- 書き込みはすべて service_role 経由。RLS は本人の読み取りのみ許可する。
-- ============================================================================

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null,
  redeemed_at timestamptz not null default now()
);

-- 紹介者ごとの成立数を数えるためのインデックス（上限判定・設定画面の人数表示）。
create index if not exists referral_redemptions_referrer_idx
  on public.referral_redemptions (referrer_user_id);

alter table public.referral_codes enable row level security;
alter table public.referral_redemptions enable row level security;

-- 自分のコードだけ読める。発行（INSERT）はサーバー（service_role）のみ。
drop policy if exists "referral_codes_select_own" on public.referral_codes;
create policy "referral_codes_select_own" on public.referral_codes
  for select using (auth.uid() = user_id);

-- 自分が紹介者である成立記録だけ読める（人数表示用）。書き込みはサーバーのみ。
drop policy if exists "referral_redemptions_select_own" on public.referral_redemptions;
create policy "referral_redemptions_select_own" on public.referral_redemptions
  for select using (auth.uid() = referrer_user_id);
