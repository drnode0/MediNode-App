-- Recall（知の球）定着エンジン。設計: docs/superpowers/specs/2026-09-02-recall-engine-design.md
--
-- recall_claims: 公開コーパスの主張（1行=主張1つ）。同期（service_role）が書き、ログイン利用者が読む。
-- recall_section_reads: 読んだ節（本人が書く）。主張ごとに行を持たない。
-- recall_progress: 残した主張の記録と SRS の状態（本人が書く）。
-- recall_review_log: 覚えた／まだ の追記ログ（本人が書く）。

create table if not exists public.recall_claims (
  claim_id         text primary key,
  page_id          text not null,
  page_title       text not null,
  page_kind        text not null default '',
  section_key      text not null default '',
  section_heading  text not null default '',
  body             text not null,
  source           text not null default '',
  confidence       text not null,              -- ok / caut / essentials
  genres           text[] not null default '{}',
  primary_genre    text not null default '',
  genre_slot       int  not null default 63,   -- 0..63。63 = その他
  holes            jsonb not null default '[]'::jsonb,
  cloze_status     text not null default 'pending',  -- pending / approved / rejected
  active           boolean not null default true,
  revised_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists recall_claims_page_id_idx on public.recall_claims (page_id);
create index if not exists recall_claims_active_idx on public.recall_claims (active);

-- RLS は有効・ポリシーは置かない（既定で全拒否）。読み書きとも service_role のみが届く。
-- 主張は /api/recall/claims が service_role で読み、そのルートが recall の機能フラグを見る。
-- authenticated に select を開くと、PostgREST 経由で誰でも主張を読めてしまい、
-- 「閉じている利用者には API のいずれにも Recall を見せない」という設計に反する。
alter table public.recall_claims enable row level security;
drop policy if exists recall_claims_select_active on public.recall_claims;

create table if not exists public.recall_section_reads (
  user_id      uuid not null,
  page_id      text not null,
  section_key  text not null,
  read_at      timestamptz not null default now(),
  primary key (user_id, page_id, section_key)
);
alter table public.recall_section_reads enable row level security;
drop policy if exists recall_section_reads_own on public.recall_section_reads;
create policy recall_section_reads_own on public.recall_section_reads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.recall_progress (
  user_id           uuid not null,
  claim_id          text not null,
  kept_at           timestamptz not null default now(),
  streak            int  not null default 0,
  interval_days     int  not null default 1,
  due_at            timestamptz not null default now(),
  last_reviewed_at  timestamptz,
  last_result       text,                       -- ok / ng / null
  ok_count          int  not null default 0,
  ng_count          int  not null default 0,
  removed_at        timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (user_id, claim_id)
);
create index if not exists recall_progress_due_idx on public.recall_progress (user_id, due_at);
alter table public.recall_progress enable row level security;
drop policy if exists recall_progress_own on public.recall_progress;
create policy recall_progress_own on public.recall_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.recall_review_log (
  id               bigserial primary key,
  user_id          uuid not null,
  claim_id         text not null,
  result           text not null,               -- ok / ng
  interval_before  int  not null,
  interval_after   int  not null,
  reviewed_at      timestamptz not null default now()
);
create index if not exists recall_review_log_user_idx on public.recall_review_log (user_id, reviewed_at);
alter table public.recall_review_log enable row level security;
drop policy if exists recall_review_log_own_select on public.recall_review_log;
create policy recall_review_log_own_select on public.recall_review_log
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists recall_review_log_own_insert on public.recall_review_log;
create policy recall_review_log_own_insert on public.recall_review_log
  for insert to authenticated with check (auth.uid() = user_id);
