# 公開記念キャンペーン＋友達紹介 設計メモ（2026-07-19）

目的: 公開直後（7/18公開）の利用者を増やす。無料おためしの階段を太くし、
最終的に**カード登録トライアル（自動課金へつながる唯一の系統）へ流れ込む**構造にする。

## 日数の階段設計

### キャンペーン中（7/18〜8/18 JST いっぱい）

| 段階 | 日数 | 変更方法 |
|---|---|---|
| ① 登録だけ（自動トライアル） | 3日→**7日** | `campaign.ts` の `autoTrialDays()` が期間で自動切替 |
| ② カード登録トライアル（Stripe） | 7日→**14日** | 既定値を14に恒久変更（期間切替なし） |
| ③ note特典コード（TRIAL_CODES） | 14日→**30日**（通常時も**21日**へ恒久アップ） | `trialCodeDays()` が期間で自動切替（env `TRIAL_DAYS` が優先） |
| ④ 友達紹介（常設・新設） | 新規**14日**・紹介者**+14日**（7/20に30→14へ。無料で1ヶ月に届く道を作らない） | `REFERRAL_NEW_USER_DAYS` / `REFERRAL_REWARD_DAYS` |

- 有料note購入者（③）が「カードなし最長」の頂点。カード登録だけの人（②14日）より明確に上位に保ち、初期購入者を裏切らない。
- キャンペーン終了（8/19 JST 0:00）で①は3日、③は21日へ自動で戻る（コード変更・再デプロイ不要）。②は14日のまま恒久。
- 序列の原則: 有料note購入者（③）は常にカード登録（②）より長い（キャンペーン中30＞14、通常21＞14）。
- 文言も `campaign.ts` から日数を取るため自動で戻る（アプリ内）。**LPは静的HTMLなので8/19に手動で戻す**（下記チェックリスト）。

## 友達紹介の仕組み

- 各ユーザーに個人コード `MN-XXXXXXXX`（紛らわしい文字除外・8桁）。設定 → プレミアムDB設定の下部に表示（初回表示時に発行）。
- 使う側は**既存のコード入力欄**に入れるだけ。`/api/premium/trial` がenv系コードに一致しない入力のうち紹介コード形式のものをDB照合（第4分岐）。
- 新規側: 14日トライアル（plan='trial'・サーバー保存・自動失効。noteコードと同じ挙動）。
- 紹介者側: +14日。契約状態で手段を変える:
  - 無料/失効 → 14日トライアル付与
  - コード式トライアル中 → `trial_ends_at` を+14日
  - Stripe課金中/カードトライアル中 → Stripe `trial_end` で次回請求を14日後ろ倒し（金銭の持ち出しなし）
  - 無期限comp → 記録のみ（延長の意味がない）
- 不正対策: 自分のコード不可／同一メール実体の別名（Gmailの+エイリアス・ドット違い）も自己紹介として拒否／受け取りは生涯1回（`referred_user_id` UNIQUE）／Stripe決済歴・comp保持者は新規側になれない／紹介者への還元は10人まで（超過後も新規側14日は有効）／既存レート制限。
- 合わせ技の安全弁（7/20追加）: ①縮み防止=`grantTrialByUserId` は既存期限と候補の長い方を採用（`pickLaterTrialEnd`）。長い期限中に短いコードを入れても縮まない・期限切れ後の再入力更新は従来どおり。②Stripe破壊防止=note/招待コード分岐の手前で `hasLiveStripeSubscription`（課金中/カードトライアル中）なら409で弾く。紹介(D)は `canRedeemReferral` の `hasStripeHistory` で別途弾き済み。UIは有効中に入力欄を隠すが、別端末・同期前・API直叩きに備えたサーバー側の二重防御。
- 既知の許容: noteコード（TRIAL_CODES）は期限切れ後の再入力で更新可能（公開前からの仕様）。毎回オーナーに通知メールが飛ぶため乱用は可視。常習が見えたら償還記録テーブルを足して1回制に締める（第2弾候補）。

## 変更ファイル（アプリ: feature/launch-campaign-referral ブランチ）

- `src/lib/campaign.ts`（新規）＋テスト … 期間・日数の一元管理
- `src/lib/referral.ts`（新規）＋テスト … コード生成・可否判定の純ロジック
- `src/lib/supabase/referrals.ts`（新規） … DBアクセス・紹介者還元（Stripe含む）
- `supabase/migrations/0009_referrals.sql`（新規） … referral_codes / referral_redemptions
- `src/app/api/referral/route.ts`（新規） … 自分のコード取得・発行
- `src/app/api/premium/trial/route.ts` … 第4分岐（紹介コード償還）＋③の日数
- `src/app/api/premium/auto-trial/route.ts` … ①の日数
- `src/app/api/premium/checkout/route.ts` … ②の既定値14日
- `src/components/SettingsPanel.tsx` … 紹介コード欄＋日数文言
- `src/components/SetupWizard.tsx` / `src/components/AppBanners.tsx` / `src/lib/help-faq.ts` … 日数文言・キャンペーン告知・紹介FAQ
- `src/app/api/admin/ledger/route.ts` / `src/app/admin/AdminLedgerClient.tsx` … 紹介成立数KPI・台帳列データ

LP（~/work/medinode-lp・campaign-2026-07 ブランチ）: 4ページの告知バー＋index/premium の日数表記＋紹介の一文。

## デプロイチェックリスト（オーナー確認後に実施）

### アプリ（medical-search-public）
1. [ ] `feature/launch-campaign-referral` を main にマージ → Vercel デプロイ
2. [ ] **Supabase で migration 0009 を適用**（referral_codes / referral_redemptions。未適用でも既存機能は壊れないが、紹介欄が出ず紹介コードも通らない）
3. [ ] Vercel 環境変数:
   - `TRIAL_DAYS` … **削除**（コードが期間で 30→21 を自動切替。設定したままだとキャンペーンが効かない）
   - `STRIPE_TRIAL_DAYS` … **削除または14に**（7のままだとカード2週間にならない）
4. [ ] **Stripe ダッシュボード: トライアル終了リマインダーメールをON**（解約忘れ対策。Settings → Subscriptions and emails）
5. [ ] 動作確認: 新規登録→7日付与／noteコード→30日／紹介コード発行→別アカウントで償還→14日＋紹介者延長／/admin のKPI表示

### LP（medinode-lp）
6. [ ] campaign-2026-07 ブランチの内容を確認して公開（go-live.sh の通常手順）

### 運用
7. [ ] note記事・LINE配布文の「14日」を「いまは30日（8/18まで）」に更新
8. [ ] キャンペーン前に14日コードを使った初期note購入者がいれば、/admin から30日相当へ延長（裏切らないケア）
9. [ ] X告知（公開記念キャンペーン＋友達紹介）

### キャンペーン終了時（8/19）
- アプリ側は自動で通常値へ戻る（作業なし）
- [ ] LPの日数表記・告知バーを通常版に戻す（このメモの表を参照）
- [ ] note記事の表記を21日（3週間）に更新
