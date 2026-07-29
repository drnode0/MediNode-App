-- MediNode 「みんなの臨床疑問」受付中の板への「私も気になる」投票。
-- cq_votes: 1人1票（primary key で担保）・取り消し可（行の削除）。
-- cq_id は Notion 受付DBのページID。誰がどの疑問に入れたかはサーバー（service_role）
-- でのみ読み、板に返すのは「自分が入れたか」と「合計何票か」だけ
-- （他人の投票者一覧は誰にも返さない）。

create table if not exists public.cq_votes (
  user_id    uuid not null,
  cq_id      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cq_id)
);

-- 板は毎回「疑問ごとの合計票数」を引くので、cq_id 側にも索引を張る。
create index if not exists cq_votes_cq_id_idx on public.cq_votes (cq_id);

alter table public.cq_votes enable row level security;

-- 読み書きともサーバー（service_role）経由のみ。
-- anon / authenticated から直接触らせない（他人の投票を数えられないようにする）。
