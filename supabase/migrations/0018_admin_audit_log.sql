-- 管理者の操作監査ログ（付与/取消/削除/モニター指定/CSV出力）。append-only。
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null,
  target_user_id uuid,
  target_email text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
-- 参照・書込はサーバー(service_role)のみ。通常ユーザー向けポリシーは作らない。
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
