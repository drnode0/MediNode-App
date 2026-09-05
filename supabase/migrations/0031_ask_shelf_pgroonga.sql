-- 任意適用。段0の候補絞り込みを速くするためだけの索引で、無くても動く
-- （src/lib/ask-shelf/rank.ts が全件読みにフォールバックする）。
-- Supabase のダッシュボードの Extensions で pgroonga を有効にしてから流す。
-- 有効でないまま流すと、この1文だけが失敗する（0030 には影響しない）。
-- 照合に使う文字列。段0の順位と足切りは TypeScript の覆い率が決めるので、
-- この列と索引は候補を速く絞るためだけにある。0030 に置くと「誰も読まない列」が
-- 残るので、索引と同じファイルにまとめる。
create extension if not exists pgroonga;
alter table public.recall_claims
  drop column if exists search_text;
alter table public.recall_claims
  add column search_text text
  generated always as (body || ' ' || section_heading || ' ' || keywords) stored;
create index if not exists recall_claims_search_text_pgroonga
  on public.recall_claims using pgroonga (search_text);
