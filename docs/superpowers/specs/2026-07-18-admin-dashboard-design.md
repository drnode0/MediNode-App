# /admin ダッシュボード改修 設計（2026-07-18・承認済み）

## 背景

- 7月に「登録時3日間自動トライアル」を導入したが、DB上は note特典コード（14日）と同じ
  `plan='trial'` で保存されるため、アカウント台帳では両者が区別できない。
- 台帳の区分チップは人数0の区分を非表示にするため、「サブスク中（課金）」が
  0人なのか機能停止なのかが画面から判別できない。
- 利用記録は `app_usage.last_used_at`（最終利用日1件）のみで、アクティブ数の推移が描けない。

## 決定事項（ユーザー承認済み）

1. **3日自動トライアルを台帳で区別する**（制度自体＝3日・付与条件は変えない）
2. **日次利用ログを追加して推移グラフを見られるようにする**（蓄積は導入日から）
3. **アクティブの主指標は7日以内（WAU）**、30日以内（MAU）は参考表示

## 実装

### 1. トライアル区分（plan='auto_trial'）

- `grantTrialByUserId(userId, days, plan)` に plan 引数（既定 'trial'）を追加。
  自動トライアル（/api/premium/auto-trial）だけ `plan='auto_trial'` を渡す。
- FREE_PLANS 等、plan='trial' を判定している箇所すべてに 'auto_trial' を加える
  （失効判定・revoke・棚卸しの挙動は trial と同一）。
- member-ledger に区分 `auto_trial`（「トライアル中（登録3日・自動）」）を新設。
- **遡及分類**: 既存の plan='trial' 行は、`user_metadata.auto_trial_granted_at` があり、
  かつ `trial_ends_at ≒ granted_at + 3日`（許容誤差あり）なら auto_trial として表示。
  コード式14日へ乗り換えた人は期限が一致しないため誤分類しない。DBは書き換えない。

### 2. 日次利用ログ

- migration `0006_app_usage_daily.sql`: `app_usage_daily(user_id, used_on date)`
  複合PK・RLS有効・ポリシーなし（service_roleのみ）。記録は「開いた日」だけ。
- `/api/usage/ping` が app_usage の upsert に加えて app_usage_daily にも1行 upsert。
- 台帳API（GET /api/admin/ledger）が直近60日の日別ユニーク利用者数 `dailyActive` を返す。

### 3. /admin ダッシュボード

- KPIカード列: 登録者数／週間アクティブ（7日・主指標）／月間アクティブ（30日・参考）／
  サブスク中（課金）／トライアル中（自動＋コード内訳）
- グラフ2枚（依存追加なし・インラインSVG）:
  - 登録者数の推移（週次新規バー＋累積線。createdAt から全期間描画可）
  - 日別アクティブ数（app_usage_daily の蓄積分）
- アクティブ内訳帯: 7日以内／30日以内／それ以前／未利用
- 区分チップ: 0人の区分も薄グレーで表示（「0人」と「非表示」を区別できるように）
- 既存の台帳テーブル・検索・CSV・付与/取り消し操作は維持

## テスト・デプロイ

- member-ledger（遡及分類含む）のユニットテストを既存スタイルで追加。vitest + next build。
- デプロイ順: Supabase へ migration 0006 適用 → コードデプロイ。
