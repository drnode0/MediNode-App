-- MediNode 「役に立った」リアクション（プレミアムナレッジ・解決済みCQ）。
-- cq_reactions: 1人1回（primary key で担保）・取り消し可（行の削除）。
-- object_id はサブスクIndexの objectID（ナレッジ/解決済みCQ共通のID空間）。
-- 誰がどれに押したかはサーバー（service_role）でのみ読み、公開面に返すのは
-- 「自分が押したか」と「合計何人か」だけ（他人の一覧は誰にも返さない）。
-- cq_votes（受付中の「私も気になる」）と同型。解決前=需要投票、解決後=評価と使い分ける。

create table if not exists public.cq_reactions (
  user_id    uuid not null,
  object_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, object_id)
);

-- 一覧・リーダーは毎回「対象ごとの合計数」を引くので、object_id 側にも索引を張る。
create index if not exists cq_reactions_object_id_idx on public.cq_reactions (object_id);

alter table public.cq_reactions enable row level security;

-- 読み書きともサーバー（service_role）経由のみ。
-- anon / authenticated から直接触らせない（他人の反応を数えられないようにする）。
