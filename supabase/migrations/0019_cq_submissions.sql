-- アプリ内CQ投稿の管理用記録（/admin アカウント台帳の「誰が投稿してくれたか」表示用）。
--
-- 方針変更（2026-07-31・オーナー決定）: 従来は通知同意者のみNotionにIDを残していたが、
-- 全投稿の userId をここに記録する。ユーザーへの公開面の約束は「実名は表示されません」
-- （表示の約束）であり、本テーブルは /admin 以外のどこにも出さないことで約束を守る。
create table if not exists public.cq_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  notion_page_id text,          -- 受付DBのページ参照（台帳から追跡用）
  question text not null,        -- 疑問文の先頭200字（一覧表示用）
  role text,                     -- 職種
  years text,                    -- 経験年数
  departments text,              -- 診療科・立場（医師のみ・カンマ結合）
  created_at timestamptz not null default now()
);
alter table public.cq_submissions enable row level security;  -- ポリシーなし＝service_role専用
create index if not exists cq_submissions_user_idx on public.cq_submissions (user_id);
-- バックフィルの二重実行防止（upsert の衝突キー）。NULL同士は衝突しない仕様なので
-- notion_page_id が取れなかった行があっても挿入は妨げない。
create unique index if not exists cq_submissions_notion_page_uidx
  on public.cq_submissions (notion_page_id);
