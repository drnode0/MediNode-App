-- LP（medinode-lp.vercel.app）訪問の時間帯・流入元の記録（アカウント台帳のLP訪問セクションのデータ源）
--
-- 既存の lp_visits（day, count = 日別の推移）に加えて:
--   lp_visits_hourly … 日付×時間帯（JST 0〜23）ごとの訪問数
--   lp_visits_source … 日付×流入元（x/note/notion/line/lp/direct/other 等）ごとの訪問数
-- どちらも集計カウントのみ。IP・UA・個人情報は一切保存しない。
-- 読み書きは /api/lp/visit（service_role）からのみ。

create table if not exists public.lp_visits_hourly (
  day date not null,
  hour int not null,
  count integer not null default 0,
  primary key (day, hour)
);

create table if not exists public.lp_visits_source (
  day date not null,
  source text not null,
  count integer not null default 0,
  primary key (day, source)
);

alter table public.lp_visits_hourly enable row level security;
alter table public.lp_visits_source enable row level security;
-- anon / authenticated からは読み書き不可（service_role のみ）。ポリシーは作らない。

-- 1回の訪問で「日別・時間帯・流入元」を同時に +1 する（すべて JST 基準の日付）。
-- 既存の increment_lp_visit（日別のみ）を置き換える上位版。/api/lp/visit の POST から呼ぶ。
create or replace function public.record_lp_visit(
  visit_day date,
  visit_hour int,
  visit_source text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.lp_visits (day, count)
  values (visit_day, 1)
  on conflict (day) do update set count = public.lp_visits.count + 1;

  insert into public.lp_visits_hourly (day, hour, count)
  values (visit_day, visit_hour, 1)
  on conflict (day, hour) do update set count = public.lp_visits_hourly.count + 1;

  insert into public.lp_visits_source (day, source, count)
  values (visit_day, visit_source, 1)
  on conflict (day, source) do update set count = public.lp_visits_source.count + 1;
$$;

-- 実行権限を絞る（service_role のみが呼べる）。
revoke all on function public.record_lp_visit(date, int, text) from public, anon, authenticated;
