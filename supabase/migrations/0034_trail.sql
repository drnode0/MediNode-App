-- 調べた記録（trail）。大型アップデートの段階1（前にも調べています・外で調べる・戻って残す）。
-- 設計の正本: Notion「MediNode 作り直しの提案｜毎日ひらく理由をつくる」柱1・段階1、
--             Notion「MediNode 大型アップデートの約束（こだわり）」。
-- 番号: 0033 は Recall の穴の候補づくり（docs/superpowers/plans/2026-09-07-recall-hole-suggestion-plan.md）が
--       予約しているので、こちらは 0034 にする（同じ番号で入れると片方が「適用済み」と誤認されて飛ぶ）。
--
-- trail_lookups … 調べた言葉。1行 = 本人 × 照合用に正規化した言葉。
--                 同じ言葉は同じ行を進める（last_searched_at と、別の機会なら times）。
--                 外で調べた先（pubmed など）は outside に足していく。
-- saved_items   … 残したもの。保存1件 = 本人が選んだ原文・出所＋任意の一言（制作計画3章の形）。
--                 段階1の出どころは lookup（外で調べて戻ってきた）と paste（貼り付け）の2つ。
--                 共有ボタン・LINE・メール・取り込みは後の段階でここに入る（origin の値を足す）。
--
-- どちらも本人の行だけを読み書きできる（RLS）。管理画面でも中身は読まない
-- （数えるときは件数だけ。supabase/admin_queries.sql の「調べた記録」の節）。
-- アカウントを消せば行も消える（auth.users への on delete cascade）。
-- 再実行しても安全（if not exists / drop policy if exists）。

create table if not exists public.trail_lookups (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  query             text not null check (char_length(query) <= 200),
  norm              text not null check (char_length(norm) between 2 and 200),
  first_searched_at timestamptz not null default now(),
  last_searched_at  timestamptz not null default now(),
  times             int  not null default 1,
  outside           text[] not null default '{}',
  outside_at        timestamptz
);
create unique index if not exists trail_lookups_user_norm_idx on public.trail_lookups (user_id, norm);
create index if not exists trail_lookups_user_last_idx on public.trail_lookups (user_id, last_searched_at desc);
alter table public.trail_lookups enable row level security;
drop policy if exists trail_lookups_own on public.trail_lookups;
create policy trail_lookups_own on public.trail_lookups
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.saved_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  origin      text not null,                     -- lookup / paste（後の段階で share / line / mail / import）
  -- 検索の記録を消しても、残したものは消えない（問いの文字は query に写して持つ）。
  lookup_id   uuid references public.trail_lookups (id) on delete set null,
  query       text check (query is null or char_length(query) <= 200),
  url         text check (url is null or char_length(url) <= 2000),
  title       text not null default '' check (char_length(title) <= 300),
  note        text not null default '' check (char_length(note) <= 2000),
  body        text not null default '' check (char_length(body) <= 10000),
  outside     text,                              -- 外の行き先の鍵（src/lib/trail/outside.ts）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists saved_items_user_created_idx on public.saved_items (user_id, created_at desc);
alter table public.saved_items enable row level security;
drop policy if exists saved_items_own on public.saved_items;
create policy saved_items_own on public.saved_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
