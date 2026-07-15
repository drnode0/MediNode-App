# Stripe Live化 チェックリスト（MediNode）

コード側は環境変数で完結しており、追加改修は不要。`STRIPE_SECRET_KEY` を
`sk_test_...` → `sk_live_...` に差し替えると、アプリ内の「テスト決済」表記
（`TestModeNotice`）が自動的に消える。以下はオーナー作業（クレデンシャルは代行不可）。

作成日: 2026-07-15 ／ 一般公開: 2026-07-18(土) 20:00

---

## 1. Stripeダッシュボードを Live モードに切替
- 右上のトグルを **本番環境（Live）** に。以降の作業はすべてLiveモードで行う
  （Test/Liveで商品・キー・Webhookは完全に別物。テストで作った物はLiveに存在しない）。
- アカウントが「本番決済有効化（本人確認・銀行口座登録）」済みか確認。未了だと
  Live Checkout が弾かれる。

## 2. 商品と価格（Price）を作成 → `STRIPE_PRICE_ID`
- 商品カタログ → 商品を追加 → 月額のサブスク価格（JPY・定期・月次）を作成。
- 発行される **`price_...`（Live）** を控える → Vercel の `STRIPE_PRICE_ID`。
- ※ トライアル日数はStripeの価格側ではなくコードの `STRIPE_TRIAL_DAYS`（既定7）で付与。

## 3. Live APIキー → `STRIPE_SECRET_KEY`
- 開発者 → APIキー → **Secret key（`sk_live_...`）** を控える → Vercel の `STRIPE_SECRET_KEY`。
- これが Live 化の本体。`sk_live_` に変わった時点でテスト表記が自動で消える。

## 4. Webhook を作成 → `STRIPE_WEBHOOK_SECRET`
- 開発者 → Webhook → エンドポイントを追加:
  - URL: `https://medical-search-public.vercel.app/api/premium/webhook`
  - 送信イベント（4つ）:
    - `checkout.session.completed`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.payment_failed`
- 発行される **署名シークレット（`whsec_...`）** を控える → Vercel の `STRIPE_WEBHOOK_SECRET`。

## 5.（任意）カスタマーポータル → `STRIPE_PORTAL_URL`
- 設定 → Billing → カスタマーポータルを有効化し、ログインリンクを取得。
- 未設定でもアプリは動く（解約UIがメール問い合わせにフォールバックするだけ）。

## 6. Vercel 本番環境変数（Production）に投入
Vercel → プロジェクト `medical-search-public` → Settings → Environment Variables → **Production**:

| 変数 | 値 |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...`（手順3） |
| `STRIPE_PRICE_ID` | `price_...`（手順2・Live） |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`（手順4） |
| `STRIPE_PORTAL_URL` | 手順5（任意・空でも可） |
| `NEXT_PUBLIC_APP_URL` | `https://medical-search-public.vercel.app`（未設定なら要設定） |

- 併せて確認: `SUBSCRIPTION_ALGOLIA_APP_ID` / **`SUBSCRIPTION_ALGOLIA_SEARCH_KEY`（Search-only）** /
  `SUBSCRIPTION_ALGOLIA_INDEX` が Production に入っているか。
  ⚠️ verify は **Search-only キー**を使う（Admin キーではない）。これが無いと
  「決済は成功したのに購入後に『Algolia設定が不足しています』でキーが受け取れない」事故になる。
- 変数変更後は **再デプロイ**（Vercelは既存デプロイに新envを自動反映しない）。

## 7. 本番での動作確認（実カード or Stripeの本番テスト）
1. アプリでプレミアム登録 → Checkout画面から「テスト決済」バッジが消えていること。
2. 実際に登録（トライアル7日・カード必須）→ `?premium_session=...` で戻り、プレミアムが有効化。
3. Stripe → Webhook → 直近の配信が **200** になっていること（署名検証OKの証拠）。
4. `/admin` 台帳でその行が「トライアル中（カード登録）」区分で出ること。
5. 解約導線（ポータル or メール）が表示されること。

---

## 補足・既知の設計
- テスト/本番の切替は `sk_test_`/`sk_live_` プレフィックスの自動判定（`GET /api/premium/checkout`）。
- トライアル終了時に支払い方法が無ければ自動キャンセル（`missing_payment_method: 'cancel'`）。
  Stripe側で「トライアル終了前リマインドメール」をONにしておくと親切。
- Webhookは Supabase 未設定でも200を返す（決済は動く）。本番はSupabase設定済みなので
  契約状態が `subscriptions` テーブルに同期される。
- モニターへの無料先行配布は Stripe と無関係（`COMP_INVITE_CODES` / `TRIAL_CODES`）。
  よって **モニター募集は Live化を待たずに出せる**。
