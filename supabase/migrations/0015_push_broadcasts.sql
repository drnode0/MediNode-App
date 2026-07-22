-- お知らせ送信の履歴（送った内容と結果）。読取は service_role のみ（admin API経由）。
create table if not exists public.push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  url text,
  sent integer not null default 0,
  pruned integer not null default 0,
  stage text,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.push_broadcasts enable row level security;
-- 読取ポリシーは作らない（service_role専用）。
