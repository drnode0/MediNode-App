-- 任意適用。段0の候補絞り込みを速くするためだけの索引で、無くても動く
-- （src/lib/ask-shelf/rank.ts が全件読みにフォールバックする）。
-- 0030 を先に流しておくこと（生成列 search_text が参照する keywords 列は
-- 0030 で足すため、0030 の前にこのファイルだけを流すと失敗する）。
-- Supabase のダッシュボードの Extensions で pgroonga を有効にしてから流す。
-- 有効でないまま流すと create extension が失敗し、Supabase SQL Editor は
-- 貼った内容を1トランザクションで流すため、失敗はこのファイルの中に閉じて
-- 他の文もまとめてロールバックする（0030 には影響しない）。
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
