-- MediNode ログイン基盤（フェーズ1）
-- ステップ1: profiles（アカウント基本情報）
-- ステップ2: subscriptions（契約状態のサーバー管理＝端末またぎ解決）
-- 全テーブルでRLSを有効化し、本人の行だけ読めるようにする。
-- サーバー（webhook/verify）は service_role キーでRLSをバイパスして書き込む。

-- ============================================================
-- profiles
-- ============================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 本人だけ自分のプロフィールを参照・更新できる。
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

-- 新規ユーザー作成時に profiles 行を自動生成するトリガー。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- subscriptions（ステップ2）
-- ============================================================
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,                       -- active / trialing / past_due / canceled
  current_period_end timestamptz,
  trial_ends_at timestamptz,         -- コード式トライアル（カード無し7日）の期限
  plan text default 'premium',
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- 本人だけ自分の契約状態を参照できる（書き込みはサーバーのみ＝service_role）。
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- stripe_customer_id から逆引きするための索引（webhook処理用）。
create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);
