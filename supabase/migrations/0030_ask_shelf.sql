-- 聞ける棚（段0＋段2）。設計: docs/superpowers/specs/2026-09-05-ask-shelf-design.md
--
-- PGroonga の索引はこのファイルに入れない。拡張が入っていない環境では
-- `create index using pgroonga` 自体が失敗し、このファイル全体が流れなくなるため。
-- 索引は 0031（任意適用）に分ける。0030 だけ流せば段0は動く（全件読みにフォールバックする）。

-- 段0の照合に使う文字列。点数（BM25）だけの照合を覆い率（本文＋節見出し＋
-- キーワード）に替えると、実測で「正解が1位」が 81% から 96% に上がった
-- （設計書 §層1 の実測の表）。キーワード欄単独の寄与は測っていない。
alter table public.recall_claims
  add column if not exists keywords text not null default '';

-- 段0を出した回の記録。完了条件「段0を見せた後に送らずに済んだ割合」をここから出す。
-- 問いの本文は利用者が書いた臨床の疑問なので、/admin 以外には出さない
-- （cq_submissions と同じ扱い）。RLS 有効・ポリシー無し＝service_role のみ。
create table if not exists public.ask_shelf_queries (
  id            bigserial primary key,
  user_id       uuid not null,
  query         text not null,
  claim_count   int  not null default 0,
  section_count int  not null default 0,
  board_count   int  not null default 0,
  top_coverage  real not null default 0,
  submitted     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists ask_shelf_queries_created_idx on public.ask_shelf_queries (created_at);
alter table public.ask_shelf_queries enable row level security;

-- 経験年数・診療科をアカウントに持たせる（裁定7）。職種は 0024 で入っている。
-- 列が無くても account-profile.ts は落ちない作りなので、流す前でも壊れない。
alter table public.user_settings
  add column if not exists experience_years text;
alter table public.user_settings
  add column if not exists doctor_departments text[];
