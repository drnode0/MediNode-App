-- MediNode 利用時間帯の記録（/admin ダッシュボードの「利用時間帯」ヒストグラムのデータ源）
-- app_usage_hourly: 「どのユーザーが どの日の 何時（JST）に アプリを開いていたか」を1時間1行で保持する。
-- /api/usage/ping が1時間に1回だけ upsert する（クライアント側で同一時間帯の再送を抑制）。
-- 記録するのは user_id・日付・時間帯のみ。何を検索・閲覧したかは保存しない
-- （プライバシーポリシー「アクセス情報」の範囲内。検索内容の記録はしない方針は不変）。

create table if not exists public.app_usage_hourly (
  user_id uuid not null references auth.users(id) on delete cascade,
  used_on date not null,
  hour smallint not null check (hour between 0 and 23),
  primary key (user_id, used_on, hour)
);

-- 集計（直近N日の時間帯別カウント）が日付範囲で走るための索引。
create index if not exists app_usage_hourly_used_on_idx on public.app_usage_hourly (used_on);

alter table public.app_usage_hourly enable row level security;

-- 読み書きともサーバー（service_role）からのみ行うため、ポリシーは作らない
-- （anon / authenticated からは SELECT も INSERT もできない）。
