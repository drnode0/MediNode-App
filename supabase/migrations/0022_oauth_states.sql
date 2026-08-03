-- MediNode かんたん接続（Notion OAuth）の state 保管。
-- v1 は state を httpOnly Cookie に置いていたが、スタンドアロンPWAのストレージは
-- Safari本体と別なので、PWAから認可へ出るとcallback側にCookieが無く完走できなかった。
-- そこで state をサーバーに持ち、「どのブラウザで認可が完了しても、本人のアプリで
-- 引き取れる」形にする。
--
-- 重要: callback はトークンを user_settings には書かず、ここに暗号化して置くだけにする。
-- 本人のログイン済みセッションからの claim を経て初めて設定へ入る（セッション固定対策）。
--
-- status の遷移は pending → completed → claimed の一方向のみ。
-- token_enc は claim 済みの行では claim 時に null へ落とす。
-- 猶予切れ（claimの猶予=CLAIM_WINDOW_MSを過ぎたcompleted行）のtoken_encも
-- oauth-states.ts の purgeExpired が同じユーザーのstart/claim呼び出し時にnullへ落とすが、
-- これは cron ではなく「そのユーザーが次に何か触ったとき」にしか走らない。
-- つまり、認可だけして二度とアプリへ戻らなかったユーザーの行は、その人が次にstart/claimを
-- 叩くまでtoken_encを保持し続ける（最終的には行自体の削除cutoffで消えるが、それは
-- もっと先である）。cronを持たない前提でのbest-effortな設計であり、無期限の残留を
-- 完全には防げないことを明記しておく。

create table if not exists public.oauth_states (
  state        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending',
  token_enc    text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- claim は「自分の completed を新しい順に1件」引くので、その形に索引を張る。
create index if not exists oauth_states_user_status_idx
  on public.oauth_states (user_id, status, completed_at desc);

alter table public.oauth_states enable row level security;

-- ポリシーを作らない＝ anon / authenticated からは一切読めない。
-- 読み書きはすべてサーバー（service_role）経由に限る。token_enc を含むため、
-- 本人であってもクライアントから直接引かせない。
