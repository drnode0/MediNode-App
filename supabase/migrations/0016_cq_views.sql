-- MediNode 「解決したみんなの臨床疑問」の参照回数（のべ閲覧回数）。
-- cq_views: サブスク公開ナレッジ（❓CQ由来）を本文（Notionページ）として開いた累計を
-- object_id ごとに1行で保持する。誰が見たか（user_id 等）は一切保存しない
-- ＝ app_usage よりさらに個人情報が軽い。クライアントが本文を開いた瞬間に
-- /api/cq/view を叩き、サーバー（service_role）が increment_cq_view で +1 する。
-- 一覧（ResolvedCqHistory）が /api/cq/views でまとめて読み、下限を超えた分だけバッジ表示する。

create table if not exists public.cq_views (
  object_id  text primary key,
  view_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cq_views enable row level security;

-- 読み書きともサーバー（service_role）からのみ行うため、ポリシーは作らない
-- （anon / authenticated からは SELECT も INSERT もできない）。

-- 原子的インクリメント（並行アクセスでも競合しない）。存在しなければ1で作成。
create or replace function public.increment_cq_view(p_object_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cq_views (object_id, view_count, updated_at)
  values (p_object_id, 1, now())
  on conflict (object_id)
  do update set view_count = cq_views.view_count + 1, updated_at = now();
$$;
