-- Web Push の購読・通知設定・段階公開フラグ。
-- 読取は本人のみ（RLS）。書込は service_role 経由のみ（INSERT/UPDATEポリシーを作らない）。

-- 1) 段階公開フラグ（off/preview/on）。stage列は 0012 で追加済み。
insert into public.app_flags (key, value, stage)
values ('push', false, 'off')
on conflict (key) do nothing;

-- 2) 購読（1ユーザーが複数端末を持ちうるので endpoint を主キー）。
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions own read" on public.push_subscriptions;
create policy "push_subscriptions own read"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

-- 3) 通知設定（マスター/種別トグル＋送信スロット）を1行jsonbで保持。
create table if not exists public.push_notify_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.push_notify_prefs enable row level security;
drop policy if exists "push_notify_prefs own read" on public.push_notify_prefs;
create policy "push_notify_prefs own read"
  on public.push_notify_prefs for select
  using (auth.uid() = user_id);

-- 4) 当日二重送信防止ログ（送った日付のみ）。
create table if not exists public.daily_push_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sent_on)
);

alter table public.daily_push_log enable row level security;
-- 読取ポリシーは作らない（service_role専用）。
