-- MediNode 個人・部署アプリ内リーダー（降格式）の Phase 0 計測。
-- 「意見の代わりにデータ」— どのブロック対応を優先するか・そもそも需要があるかを
-- 実測で決めるための2テーブル。どちらも回数だけを貯め、ページ内容・閲覧者は保存しない
-- （cq_views と同じ方針）。読み書きともサーバー（service_role）のみ＝ポリシーなし。
--
-- 採番メモ: supabase/migrations/ の最終は 0023 だが、トップレベル migrations/ に
-- 0024_user_occupation.sql が存在するため、衝突回避で 0025 を使う。

-- ① ブロックタイプ分布。個人・部署syncの穴埋め抽出（cloze-sync）が本文を読む際に
--    type別出現数を集計し、record_block_type_counts でまとめて加算する。
--    「未対応ブロックがどれだけ出るか」＝リーダー対応追加の優先度データ。
create table if not exists public.block_type_stats (
  block_type text primary key,
  seen_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.block_type_stats enable row level security;

-- p_counts は {"paragraph": 120, "toggle": 8, ...} 形式の jsonb。
-- 数値でない値・空キーは黙って読み飛ばす（同期を止めない）。
create or replace function public.record_block_type_counts(p_counts jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  for k, v in select * from jsonb_each(p_counts)
  loop
    if k = '' or jsonb_typeof(v) <> 'number' then
      continue;
    end if;
    insert into public.block_type_stats (block_type, seen_count, updated_at)
    values (k, (v::text)::bigint, now())
    on conflict (block_type)
    do update set seen_count = block_type_stats.seen_count + excluded.seen_count,
                  updated_at = now();
  end loop;
end;
$$;

-- ② 「Notionで開く」タップ（アプリ外への離脱）。クイズ・今日の1問から個人/部署ページへ
--    飛ばされた回数＝アプリ内リーダーの需要の数値化。context は 'quiz' / 'daily_question' /
--    'reader' 等の発生場所。日単位で持ち、/adminで推移も見られるようにする。
create table if not exists public.notion_escape_taps (
  context  text not null,
  day      date not null,
  tap_count bigint not null default 0,
  primary key (context, day)
);

alter table public.notion_escape_taps enable row level security;

create or replace function public.increment_notion_escape(p_context text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notion_escape_taps (context, day, tap_count)
  values (p_context, (now() at time zone 'Asia/Tokyo')::date, 1)
  on conflict (context, day)
  do update set tap_count = notion_escape_taps.tap_count + 1;
$$;
