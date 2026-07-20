# アカウント台帳 ブラッシュアップ｜スペック② 安全管理（運用セキュリティ）

- 日付: 2026-07-20
- 対象: `/admin`（アカウント台帳）= `src/app/admin/AdminLedgerClient.tsx` / `src/app/api/admin/ledger/route.ts` ほか
- 前提: スペック①（説明＋マーケ可視化）は本番反映済み。本スペックはミューテーション経路の改修・新テーブル・Stripe照合を伴う。
- 確定した方針:
  - メール表示＝**既定表示 → 任意でマスク**（ワンタップ「メールを隠す」トグル）
  - Stripe不整合＝**ローカル突合（常時）＋「Stripeと照合」ボタン（押下時のみ Stripe API）**

## 目的

台帳を「アプリ管理のメイン」にするうえで欠けている運用セキュリティを補う。ユーザー選択の4機能:
1. 操作監査ログ（誰がいつ 付与/取消/削除/モニター指定/CSV出力 をしたか）
2. Stripe契約と台帳の不整合検知（過去の「宙に浮いた契約」の再発防止）
3. 異常兆候パネル（ヒューリスティック。真の重複判定ではないことを明示）
4. メール表示のマスキング（任意）＋CSVエクスポート時の注意・記録

## 全体方針・安全性

- 既存の堅牢性方針を踏襲: 監査テーブル未適用など**データが無い時は try/catch で空扱い**し、台帳本体は絶対に落とさない（スペック①での `created_at` 事故の教訓）。
- 認証は現状のまま（`requireAdmin` メールallowlist）。監査ログ・Stripe照合エンドポイントも全て `requireAdmin` の内側。
- 監査ログ書き込みは**主アクションを阻害しない**（付与や削除が成功したら監査失敗は握りつぶしログのみ）。
- 派生・判定ロジックは純関数 `src/lib/ledger-safety.ts`（新規）に切り出しテストする。

---

## 機能1: 操作監査ログ

### テーブル（migration `supabase/migrations/0011_admin_audit_log.sql`）

```sql
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_email text not null,               -- 操作した管理者のメール
  action text not null,                    -- grant_comp / revoke_comp / delete_user / set_monitor / unset_monitor / export_csv
  target_user_id uuid,                     -- 対象ユーザー（該当する操作のみ）
  target_email text,
  detail jsonb,                            -- 補足（区分・件数など）
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
-- 参照・書込はサーバー(service_role)のみ。通常ユーザー向けポリシーは作らない（＝誰も直接読めない）。
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
```

**適用は手動**（Supabase SQL Editor）。適用前でもアプリは動く（書込/読取を try/catch）。

### 書き込み（`src/lib/admin-audit.ts` 新規）

```ts
export type AdminAction =
  | 'grant_comp' | 'revoke_comp' | 'delete_user'
  | 'set_monitor' | 'unset_monitor' | 'export_csv'

export async function logAdminAction(
  admin: SupabaseClient,
  entry: { actorEmail: string; action: AdminAction; targetUserId?: string | null; targetEmail?: string | null; detail?: unknown }
): Promise<void> {
  try {
    await admin.from('admin_audit_log').insert({ ... })
  } catch { /* テーブル未適用・失敗でも主アクションは止めない */ }
}
```

### 差し込み箇所

- `ledger/route.ts` POST（永続無料付与）→ `grant_comp`
- `ledger/route.ts` DELETE（ユーザー削除）→ `delete_user`
- `ledger/route.ts` PATCH（モニター指定/解除）→ `set_monitor` / `unset_monitor`
- 取消（`/api/premium/comp` 側の revoke パス）→ `revoke_comp`（実装時にエンドポイントを確認して差し込む）
- CSV出力・後述の機能4 → `export_csv`（クライアントから `POST /api/admin/ledger { action:'audit', event:'export_csv' }` で記録）

`requireAdmin()` は認可済みメールを返すよう小改修（もしくはハンドラ内で取得済みのメールを使う）。actorEmail はサーバーが確定した値のみ使う（クライアント申告は使わない）。

### 表示

台帳下部に「操作履歴（最近50件）」セクション。GETレスポンスに `auditLog`（最近50件・try/catchで空可）を足し、時刻・操作・対象メール・実行者を1行で表示。未適用時は「まだ記録がありません／テーブル適用待ち」を出す。

---

## 機能2: Stripe契約と台帳の不整合検知

### ローカル突合（常時・軽量、`ledger-safety.ts`）

行データから純関数で「要確認」を抽出:
- `detectLocalContractIssues(rows): ContractIssue[]`
  - **課金中なのにStripe顧客IDなし**: `status==='active' && plan==='premium' && !hasStripe`
  - **区分と契約の矛盾**: `hasStripe && kind==='free'`（Stripe紐付があるのに無効区分）
  - 各 issue = `{ userId, email, reason, severity }`

行に `status/plan/hasStripe` は既にあるので追加フェッチ不要。

### Stripeと照合（ボタン押下時のみ）

`POST /api/admin/ledger { action:'stripe_reconcile' }`:
- `stripe.subscriptions.list({ status:'all', limit:100 })` をページング取得
- ローカル `subscriptions`（`stripe_subscription_id`/`stripe_customer_id`）と突合し、
  - **宙に浮いた契約**: Stripe側に active/trialing があるのにローカルに行が無い（＝未ログイン決済等）
  - **取り残し**: ローカルは premium なのにStripe側に active が無い
- 結果を `{ orphanStripe:[...], staleLocal:[...] }` で返し、パネルに表示。Stripe未設定（キーなし）なら「Stripe未設定」を返す。
- 規模が小さい（数十件）ため負荷は軽微。ボタンにローディング表示。
- この照合自体も監査ログに残す（`action` 追加は任意。まずは残さずMVP）。

### 表示

「契約の要確認」パネル。常時はローカル issue を列挙、`0件なら「異常なし」`。「Stripeと照合」ボタンで実照合を実行し、宙に浮いた契約・取り残しを追記表示。各行に対象メール＋理由。Stripeダッシュボードで確認できるよう補足リンク（顧客ページ）を出す。

---

## 機能3: 異常兆候パネル（ヒューリスティック）

**重要**: 登録時にIP/フィンガープリントを保存していないため、**同一人物・重複アカウントの断定はできない**。これは「気になる兆候」であり確定ではない旨をパネル冒頭に明記する。

`ledger-safety.ts` の純関数で抽出:
- `detectAnomalySignals(rows, dailyRegistrations): AnomalySignal[]`
  - **登録の急増スパイク**: ある日の新規登録が閾値超（`> max(5, 3×中央値)`）→ 日付＋件数
  - **紹介の異常集中**: `referralCount >= 10` のアドボケイト → 自己紹介乱用の可能性
  - **使い捨てメールドメイン**: 既知の使い捨てドメイン（mailinator.com / guerrillamail / 10minutemail 等の小さな内蔵リスト）に一致するメール → 件数＋対象
  - **自動トライアル未利用のまま失効間近**: `auto_trial && !premiumUsedAt && 失効まで24h以内` → 件数（運用ナッジ）

各 signal = `{ key, label, count, level:'info'|'watch', hint }`。
表示は「気になる兆候」パネル。0件なら控えめに「特筆すべき兆候はありません」。

日次登録数はクライアントで `rows` の `createdAt` から集計（既存 `buildCumulativeSeries` の素材と同じ）。

---

## 機能4: メールマスキング（任意）＋CSV注意

### マスキング

- 既定は**表示**。ツールバーに「メールを隠す」トグル（`EyeOff`/`Eye`）。
- ON時、テーブルの全メールを `maskEmail()` で `t***@gmail.com` 形式に。IDコピー等の操作は維持。
- `maskEmail(email): string` は `ledger-safety.ts` の純関数（先頭1文字＋`***`＋`@`以降）。テストする。
- クライアント状態のみ（永続化不要）。

### CSVエクスポート注意＋記録

- CSVダウンロード前に確認ダイアログ:「個人情報（メールアドレス等）を含みます。取り扱いに注意してください。続けますか？」
- 承認後、ダウンロード実行＋ `POST /api/admin/ledger { action:'audit', event:'export_csv', detail:{ count } }` で監査記録。
- マスクON時のCSVは**マスクした状態で出力**するかは、既定＝生値（CSVは分析用途）。ダイアログ文言で「メールを含む」ことを明示するので生値で出す。

---

## 配置（台帳内）

- ツールバー（CSV/更新の並び）に「メールを隠す」トグルを追加。
- KPI／マーケの下、テーブルの手前に「**契約の要確認**（機能2）」「**気になる兆候**（機能3）」の2パネルを並べる（安全系サマリーとして目立たせる）。
- ページ最下部（既存の長い注釈の下）に「**操作履歴**（機能1）」。

## データ取得・エンドポイント変更

- `GET /api/admin/ledger`: レスポンスに `auditLog`（最近50件・try/catch空可）を追加。
- `POST /api/admin/ledger`: `action` を分岐制に拡張し `audit`（export_csv記録）と `stripe_reconcile`（Stripe照合）を追加。既存の付与処理は `action` 未指定＝従来通り、で後方互換。
- 各ミューテーション（POST付与/DELETE/PATCH）に `logAdminAction` を差し込む。
- `requireAdmin()` の戻り値に認可済みメールを含める（無ければハンドラ内で `getUser` 済みメールを使う）。

## テスト

`src/lib/__tests__/ledger-safety.test.ts`:
- `maskEmail`: 通常/記号/短いローカル部/`@`なし異常入力
- `detectLocalContractIssues`: 各ルールの陽性・陰性
- `detectAnomalySignals`: スパイク閾値の境界、紹介集中、使い捨てドメイン一致、失効間近
- `admin-audit` / Stripe照合はネットワーク依存のため単体テストは純関数部分（突合ロジックを純関数 `reconcileStripe(localSubs, stripeSubs)` に分離してテスト）に限定。

## 非スコープ

- 真の重複アカウント判定（IP/fingerprint未保存のため不可）。将来 signup 時に計測を足せば拡張可能。
- 監査ログの改ざん防止（署名等）・長期保管ポリシー。まずは append-only テーブルで足る。
- メールreveal操作の逐一記録（既定表示のため不要）。

## リスクと運用

- **migration 0011 の手動適用が必要**（Supabase SQL Editor）。未適用でもアプリは動作（監査は「適用待ち」表示）。適用後に記録が貯まる。
- Stripe照合はキー未設定でも安全にスキップ（「Stripe未設定」表示）。
- 削除・付与の既存安全弁（管理者削除禁止・Stripe契約者への付与拒否・メール再入力確認）は維持。
