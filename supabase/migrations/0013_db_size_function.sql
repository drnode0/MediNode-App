-- DB総容量（バイト）を返す関数。Supabase無料枠 500MB に対する使用量表示用
-- （/admin 運用ダッシュボードの「枠の残り」ゲージ）。
-- 引数なし・読み取りのみ。service_role からのみ実行可（管理API /api/admin/daily 経由でのみ使用）。
create or replace function public.get_db_size()
returns bigint
language sql
security definer
set search_path = ''
as $$ select pg_database_size(current_database()); $$;

revoke all on function public.get_db_size() from public, anon, authenticated;
grant execute on function public.get_db_size() to service_role;
