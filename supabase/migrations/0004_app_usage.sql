-- MediNode 最終利用日の記録（アカウント台帳 /admin の「最終利用」列）
-- app_usage: ログイン中のユーザーがアプリを開いた日を1行で保持する。
-- クライアントが1日1回だけ /api/usage/ping を叩き、サーバー（service_role）が upsert する。
-- 「最終ログイン」（Supabase auth の last_sign_in_at）はログイン成立時にしか動かないため、
-- ログインしっぱなしの端末（スマホPWA等）でも実際の利用が見えるようにするのが目的。
-- 記録するのは日時のみ（何を検索したか等は保存しない）。

create table if not exists public.app_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_used_at timestamptz not null default now()
);

alter table public.app_usage enable row level security;

-- 読み書きともサーバー（service_role）からのみ行うため、ポリシーは作らない
-- （anon / authenticated からは SELECT も INSERT もできない）。
