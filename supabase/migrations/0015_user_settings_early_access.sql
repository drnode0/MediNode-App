-- 先行体験（マルチ部署串刺し検索）の開放フラグを user_settings に追加。
-- /admin の台帳から個別ユーザーに ON/OFF でき、premium/status がこの列を参照する。
--
-- 経緯: 65763d8 で先行体験のコードは本番投入されたが、この列を追加する SQL が
-- 未作成だったため、/admin の台帳が
--   "column user_settings.early_access does not exist"
-- で落ちていた。その修復。add column if not exists で冪等・既存行は default false。
alter table public.user_settings
  add column if not exists early_access boolean not null default false;
