-- MediNode 2階建てサブスク転換（フェーズ2: ¥200本体 + ¥708プレミアムアドオン）
-- ============================================================================
-- 【ステータス】草案。まだ適用しないこと（オーナー確認後に supabase db push 等で適用）。
-- 目的: subscriptions テーブルを単一プラン(premium固定)から2階建てに拡張する。
--   - has_base    : アプリ本体プラン(¥200)を契約しているか
--   - has_premium : プレミアムアドオン(¥708, 合計¥908)を契約しているか
-- 既存の plan カラムは後方互換のため残す（将来削除可）。
-- ============================================================================

-- 2フラグ方式（判定が素直なので推奨）。
alter table public.subscriptions
  add column if not exists has_base boolean not null default false;

alter table public.subscriptions
  add column if not exists has_premium boolean not null default false;

-- どのプラン階層かを人間可読で持っておく補助カラム（任意・UIやログ用）。
--   'none' | 'base' | 'premium'   ※premium は本体＋アドオン両方を意味する
alter table public.subscriptions
  add column if not exists tier text default 'none';

-- ----------------------------------------------------------------------------
-- 既存データの移行
--   現状の実ユーザーはオーナー1人（未配布）。
--   旧 plan='premium' かつ status が有効な行は「本体＋プレミアム両方」とみなす。
-- ----------------------------------------------------------------------------
update public.subscriptions
set has_base = true,
    has_premium = true,
    tier = 'premium'
where plan = 'premium'
  and status in ('active', 'trialing');

-- ----------------------------------------------------------------------------
-- 補足
--   - status (active/trialing/past_due/canceled) は引き続き「契約が生きているか」を表す。
--   - 実際の機能ゲートは status有効 かつ has_base / has_premium で判定する（アプリ側）。
--   - RLS ポリシーは 0001 のものを継承（本人のみ select、書き込みは service_role）。
-- ----------------------------------------------------------------------------
