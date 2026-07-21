-- 「今日の1問」の段階公開フラグと回答日ログ。
--
-- 1) app_flags に3段階（off/preview/on）を持てる stage 列を追加する。
--    既存の value(boolean) はメンテナンスモード用にそのまま残す。
--    読取は公開read（既存ポリシー）、書込は service_role のみ（変更なし）。
alter table public.app_flags add column if not exists stage text;

insert into public.app_flags (key, value, stage)
values ('daily_question', false, 'off')
on conflict (key) do nothing;

-- 2) 回答した「日付だけ」を記録する（何を答えたか・正誤は保存しない＝プライバシー方針）。
--    草（アクティビティ）・ログインボーナス・復帰頻度の土台。app_usage_daily と同型。
create table if not exists public.daily_question_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  answered_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, answered_on)
);

alter table public.daily_question_log enable row level security;

-- 本人のみ読める。書き込みポリシーは意図的に作らない＝service_role 経由のみ。
drop policy if exists "daily_question_log own read" on public.daily_question_log;
create policy "daily_question_log own read"
  on public.daily_question_log for select
  using (auth.uid() = user_id);
