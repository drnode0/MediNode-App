-- ============================================================
-- MediNode 運用クエリ集（登録アドレスの管理・可視化）
-- ------------------------------------------------------------
-- 使い方: Supabase ダッシュボード → 左メニュー「SQL Editor」→ 新規クエリに
--         必要なブロックを貼り付けて Run。読み取り専用（SELECT のみ）なので安全。
-- 対象テーブル:
--   auth.users          … 認証ユーザー本体（email / created_at / last_sign_in_at）
--   public.profiles     … 登録時に自動生成されるプロフィール（0001_login_foundation.sql）
--   public.subscriptions… 契約状態（status / current_period_end / trial_ends_at / plan）
-- 「アクティブ」の定義はプロダクト判断で変わるため、下記に複数の観点を用意した。
-- ============================================================


-- ① 登録者数（総数）--------------------------------------------
-- 「実際に何人が登録しているか」。auth.users が正本。
select count(*) as registered_users
from auth.users;


-- ② 直近の登録数（期間別）------------------------------------
select
  count(*) filter (where created_at >= now() - interval '24 hours') as last_24h,
  count(*) filter (where created_at >= now() - interval '7 days')   as last_7d,
  count(*) filter (where created_at >= now() - interval '30 days')  as last_30d
from auth.users;


-- ③ アクティブアカウント（最終ログイン基準）------------------
-- last_sign_in_at を「最近アプリに戻ってきたか」の目安にする。
-- ※ セッションが有効な間は再ログインが発生しないため、あくまで下限の目安。
select
  count(*) filter (where last_sign_in_at >= now() - interval '7 days')  as active_7d,
  count(*) filter (where last_sign_in_at >= now() - interval '30 days') as active_30d,
  count(*) filter (where last_sign_in_at is null)                       as never_signed_in
from auth.users;


-- ④ アクティブアカウント（契約状態基準）----------------------
-- 課金・トライアルの観点で「有効なプレミアム」を数える。
--   - status = 'active'   … 有料課金中（Stripe）
--   - status = 'trialing' … カード登録トライアル中（Stripe）
--   - trial_ends_at > now … コード式トライアル（カード不要）が有効
select
  count(*) filter (where status = 'active')                                    as paid_active,
  count(*) filter (where status = 'trialing')                                  as card_trialing,
  count(*) filter (where trial_ends_at is not null and trial_ends_at > now())  as code_trial_valid,
  count(*) filter (where plan = 'comp')                                        as comp_invited,
  count(*)                                                                     as subscription_rows
from public.subscriptions;


-- ⑤ 一覧（登録日・最終ログイン・契約状態を横断）--------------
-- 個々のアドレスを人数と一緒に確認したいとき。新しい登録順。
select
  u.email,
  u.created_at                              as registered_at,
  u.last_sign_in_at,
  s.status                                  as sub_status,
  s.plan                                    as sub_plan,
  s.trial_ends_at,
  s.current_period_end,
  (u.raw_user_meta_data ->> 'welcome_sent_at') is not null as welcome_mail_sent
from auth.users u
left join public.subscriptions s on s.user_id = u.id
order by u.created_at desc;


-- ⑥ 日別の新規登録推移（直近30日）----------------------------
-- 予告・note投稿の反響を日付で見たいとき。
select
  date_trunc('day', created_at)::date as day,
  count(*)                            as signups
from auth.users
where created_at >= now() - interval '30 days'
group by 1
order by 1 desc;


-- ⑦ サマリー1行（ダッシュボード用の要約）--------------------
select
  (select count(*) from auth.users)                                                       as registered_total,
  (select count(*) from auth.users where created_at >= now() - interval '7 days')         as new_7d,
  (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days')   as active_30d,
  (select count(*) from public.subscriptions where status in ('active','trialing'))       as stripe_active_or_trialing,
  (select count(*) from public.subscriptions where trial_ends_at > now())                 as code_trial_valid;
