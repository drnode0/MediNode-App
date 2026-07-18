-- MediNode 日次利用ログ（/admin ダッシュボードの「日別アクティブ数」グラフのデータ源）
-- app_usage_daily: 「どのユーザーが どの日に アプリを開いたか」を1日1行だけ保持する。
-- 既存の app_usage（最終利用日のみ）では推移が描けないため、日付の履歴を持つ表を足す。
-- /api/usage/ping が app_usage の upsert と同時にここへも1行 upsert する（1日1回）。
-- 記録するのは user_id と日付のみ。何を検索・閲覧したかは保存しない。

create table if not exists public.app_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  used_on date not null default (now() at time zone 'Asia/Tokyo')::date,
  primary key (user_id, used_on)
);

-- 集計クエリ（日別ユニーク数）が日付範囲で走るため、used_on 起点の索引を足しておく。
create index if not exists app_usage_daily_used_on_idx on public.app_usage_daily (used_on);

alter table public.app_usage_daily enable row level security;

-- 読み書きともサーバー（service_role）からのみ行うため、ポリシーは作らない
-- （anon / authenticated からは SELECT も INSERT もできない）。
