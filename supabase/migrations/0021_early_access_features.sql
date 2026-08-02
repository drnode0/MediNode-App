-- MediNode 機能別の先行体験。
-- これまで user_settings.early_access（boolean）1本が「マルチ部署検索」と「知の塔」を
-- 兼務していた。3つ目（かんたん接続の実機検証）を足すにあたり、機能名の配列に分ける。
--
-- 既存の early_access 列は残す。読み取り側（feature-access.ts）が
-- 「early_access=true なら multi_department と tower を持つ」と解釈するため、
-- 既存行のバックフィルは不要（＝この migration を流しても誰の見え方も変わらない）。
--
-- 値に入るのは 'easy_connect' / 'multi_department' / 'tower' のいずれか。
-- 未知の文字列が入っても読み取り側が無視するだけなので、check 制約は付けない
-- （機能を増やすたびに制約を触る必要をなくす）。

alter table public.user_settings
  add column if not exists early_access_features text[] not null default '{}';
