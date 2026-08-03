-- Finding1（oauth_states 全体スイープ化）に伴う索引追加。
--
-- purgeExpiredStates は user_id での絞り込みをやめ、oauth_states 全体を対象に
-- 2本のクエリを実行するようになった（src/lib/supabase/oauth-states.ts）。
--   1) delete ... where created_at < cutoff
--   2) update ... where status = 'completed' and completed_at < cutoff
-- 既存の oauth_states_user_status_idx は (user_id, status, completed_at desc) なので、
-- 先頭が user_id の等値条件を含まないこの2クエリには効かない。
-- テーブルは「認可だけして戻らなかった行」が積み上がりうる前提（cronを持たない設計）
-- なので、行数が伸びたときにフルスキャンへ落ちないよう、新しいクエリ形状に合わせた
-- 索引を張る。

create index if not exists oauth_states_created_at_idx
  on public.oauth_states (created_at);

create index if not exists oauth_states_status_completed_at_idx
  on public.oauth_states (status, completed_at);
