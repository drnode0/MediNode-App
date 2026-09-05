-- 任意適用。いまは流さなくてよい（2026-09-05 時点で、この列と索引を読むコードは無い）。
-- 段0の検索（src/app/api/ask-shelf/search/route.ts）は active な主張を毎回すべて読み、
-- 順位と足切りは TypeScript の覆い率が決める。ここで流すと、有料の主張の本文を複製した
-- 生成列と、誰も引かない索引が全行に増えるだけになる。
-- 流すのは、全件読みが実際の負担になってから（設計書の再検討ライン＝主張が 2,000 を超えたとき）。
-- そのときは search/route.ts に候補の絞り込みを足す（足すまでは索引は使われない）。
-- 0030 を先に流しておくこと（生成列 search_text が参照する keywords 列は
-- 0030 で足すため、0030 の前にこのファイルだけを流すと失敗する）。
-- Supabase のダッシュボードの Extensions で pgroonga を有効にしてから流す。
-- 有効でないまま流すと create extension が失敗し、Supabase SQL Editor は
-- 貼った内容を1トランザクションで流すため、失敗はこのファイルの中に閉じて
-- 他の文もまとめてロールバックする（0030 には影響しない）。
-- 照合に使う文字列。段0の順位と足切りは TypeScript の覆い率が決めるので、
-- この列と索引は将来の候補の絞り込みのためだけにある（いまは誰も読まない）。
-- 0030 に置くと未使用の列が本体側に残るので、索引と同じこのファイルにまとめる。
create extension if not exists pgroonga;
alter table public.recall_claims
  drop column if exists search_text;
alter table public.recall_claims
  add column search_text text
  generated always as (body || ' ' || section_heading || ' ' || keywords) stored;
create index if not exists recall_claims_search_text_pgroonga
  on public.recall_claims using pgroonga (search_text);
