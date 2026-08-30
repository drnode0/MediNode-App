-- 📚 Essentials の各節末「この節から生まれた問い」への「気になる」投票。
-- 目的はオーナーが次に作るCQの優先順位付け（読者の関心を集める）。
--
-- 流儀は cq_votes（0017）と同じ: 1人1票（primary key で担保）・取り消し可（行の削除）。
-- 誰がどの問いに入れたかはサーバー（service_role）でのみ読み、読者に返すのは
-- 「自分が入れたか」と「合計何票か」だけ（投票者一覧は誰にも返さない）。
--
-- block_id は Notion 原本の問い行（箇条書きブロック）のID。準備中の問いには
-- ページが無いため、cq_votes の cq_id（ページID）とはID空間が別。混ぜると
-- 集計の意味が濁るので専用テーブルにする。page_id はどの記事の問いかを引くための索引。
-- 問いの文言は行に持たない（原本・保存済みスプレッドの deep から blockId で引ける）。

create table if not exists public.question_interest (
  user_id    uuid not null,
  block_id   text not null,
  page_id    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, block_id)
);

-- 記事単位・問い単位の集計で引くので両方に索引を張る。
create index if not exists question_interest_block_id_idx on public.question_interest (block_id);
create index if not exists question_interest_page_id_idx on public.question_interest (page_id);

alter table public.question_interest enable row level security;

-- 読み書きともサーバー（service_role）経由のみ（cq_votes と同じ線引き）。
