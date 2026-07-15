-- LP（medinode-lp.vercel.app）の訪問カウンター（フッターの「今日・昨日・累計」表示のデータ源）
-- lp_visits: 1日1行（JST基準の日付）で訪問数を保持する。
-- 読み書きは /api/lp/visit（service_role）からのみ。個人情報は一切保存しない（数だけ）。

create table if not exists public.lp_visits (
  day date primary key,
  count integer not null default 0
);

alter table public.lp_visits enable row level security;
-- anon / authenticated からは SELECT も INSERT もできない（service_role のみ）。ポリシーは作らない。

-- 指定日のカウントを +1 する（行が無ければ作成）。/api/lp/visit の POST から rpc で呼ぶ。
create or replace function public.increment_lp_visit(visit_day date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.lp_visits (day, count)
  values (visit_day, 1)
  on conflict (day) do update set count = public.lp_visits.count + 1;
$$;

-- 実行権限を絞る（service_role のみが呼べる）。
revoke all on function public.increment_lp_visit(date) from public, anon, authenticated;
