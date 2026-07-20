-- アプリ全体のON/OFFフラグ（1行1キー）。初回はメンテナンスモード用。
-- 読取は公開（anon）＝proxy/クライアントがRLS下で読める。書込は service_role のみ（ポリシーを作らない）。
create table if not exists public.app_flags (
  key text primary key,
  value boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_flags enable row level security;

-- 公開read（anon/authenticated）。書込ポリシーは意図的に作らない＝service_roleのみ更新可。
drop policy if exists "app_flags public read" on public.app_flags;
create policy "app_flags public read"
  on public.app_flags for select
  using (true);

-- メンテナンスフラグの初期行（既にあれば触らない）。
insert into public.app_flags (key, value)
values ('maintenance', false)
on conflict (key) do nothing;
