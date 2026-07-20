# アカウント台帳 ブラッシュアップ｜スペック① 説明レイヤー ＋ マーケ可視化

- 日付: 2026-07-20
- 対象: `/admin`（アカウント台帳）= `src/app/admin/AdminLedgerClient.tsx` / `AdminCharts.tsx`
- スコープ: **表示のみ**（既存データからの派生／新規スキーマなし／ミューテーション経路に手を入れない）
- 続き: 安全管理（監査ログ・Stripe不整合・異常兆候・メールマスキング）は **スペック②** で別途設計する

## 背景と目的

台帳はすでに登録推移・WAU/MAU・流入元・LP訪問・セットアップ離脱・紹介ランキング・イベント縦線まで作り込まれている。ただし
1. 一部セクションに独立した説明がなく「これ何だっけ」となる
2. マーケの意思決定に直結する **転換率・チャネル別の質・売上（MRR）** が数字として出ていない（素材は揃っているが集計されていない）

この2点を、閲覧専用・低リスクの範囲で埋める。

## 用語の確定（`src/lib/member-ledger.ts` の区分に準拠）

派生区分 `MemberKind`: `admin / comp / premium / stripe_trial / trial / auto_trial / expired / free`

本スペックでの集計上の定義（**すべてこの定義でツールチップにも明記する**）:

- **課金（paying）** = `kind === 'premium'`（Stripeで実際に課金中）
- **無料トライアル中** = `trial + auto_trial + stripe_trial`（stripe_trial はカード登録済みの無料期間）
- **失効/解約（churned）** = `kind === 'expired'`。うち **課金からの解約** = `expired かつ stripe_customer_id あり`
- **MRR** = `count(premium) × 980`（プレミアムは単一プラン月額980円税込。`STRIPE_PRICE_ID` は1本）
- **流入元** = `acq_source` を正規化した `x / note / line / その他`（`normalizeSource` 既存ロジックに準拠）

## 全体方針

`AdminLedgerClient.tsx` はすでに1165行と大きい。本スペックで追加する派生ロジックは**純関数として `src/lib/ledger-metrics.ts`（新規）に切り出し**、ユニットテストを付ける。UI部品（見出し・ツールチップ・ファネル）は小さく分離する。既存の手書きSVGチャート方針（外部ライブラリ不使用）を踏襲する。

---

## A. 説明レイヤー

### A-1. 部品 `SectionHeading`（新規, `src/app/admin/SectionHeading.tsx`）

props:
- `title: string`
- `caption?: string` — 見出し直下に常時表示する薄いグレーの1行説明
- `help?: React.ReactNode` — 「?」アイコンに載せる**正確な定義**（母数・計算方法・除外条件）

挙動:
- 「?」は **ホバーとタップ（クリック）両対応**。管理者がスマホで見ることがあるため、タップでポップオーバーが開き、外側タップで閉じる。`title` 属性頼みにしない（モバイルで出ないため）。
- ポップオーバーは軽量な自作（既存の Tailwind／`brand-*` 配色、ダークモード対応）。新規ライブラリは足さない。

### A-2. 適用対象

**独立キャプションが無い既存セクション**にキャプション＋定義を付ける:
- 日別アクティブ数（直近30日）
- 利用時間帯（直近30日・JST）
- 最終利用の内訳
- 使う知識の選択（専門医/自分/みんな）
- 接続モード（シンプル/パワー）／DB設定（テンプレ複製/既存DB連携）
- 区分サマリーチップ

**6枚のKPIカード**に「?」定義を追加（`sub` テキストは残す）:
- 登録者数 … 「auth.users の全アカウント数。直近7日の増分を併記」
- WAU … 「直近7日にアプリ利用（app_usage）が記録された人数」
- MAU … 「直近30日に利用記録がある人数（参考値）」
- サブスク中 … 「`premium`＝Stripe課金中。カード登録トライアル（`stripe_trial`）は別カウントで併記」
- 無料トライアル中 … 「`trial`（コード）＋`auto_trial`（登録時自動3日）。カード登録なし・期限で自動失効」
- 友達紹介で開始 … 「`referral_redemptions` 経由で登録した人数」

既存で説明が足りているもの（登録推移の脚注、流入元の脚注、LP訪問の脚注、テーブル末尾の長い注釈）は**そのまま活かす**。テーブル末尾注釈と重複する定義は増やさない。

---

## B. マーケ可視化（新規4枚・すべて既存データの派生）

派生は `src/lib/ledger-metrics.ts` に純関数で実装しテストする。

### B-1. 転換率ファネル `FunnelCard`

縦4段のファネル。各段: 人数 ＋ 前段からの転換率%。

| 段 | 母数 | ソース |
|---|---|---|
| LP訪問（ユニーク） | `lpDaily` の合計 | `lp_visits` |
| 登録 | `rows.length` | auth.users |
| トライアル開始 | `trial + auto_trial + stripe_trial + premium`（＝一度でも試用/課金に至った人。現在課金中も「試用は済んでいる」ため含む） | rows |
| 課金 | `premium` | rows |

**重要な注記（キャプションに明記）**: LP訪問は匿名で個人を登録と紐付けできないため、LP→登録の比率は「**訪問数ベースの概算**」であること。登録以降の段は同一母集団の内訳なので正確。

### B-2. トライアル→課金 ＆ 解約率 `RetentionCard`

- **トライアル→課金 転換率** = `premium / (premium + stripe_trial + trial + auto_trial + churnedPaying)` を「試用を経た母集団のうち課金に至った割合」として表示。定義をツールチップに明記。
- **解約率（churn）** = `churnedPaying / (premium + churnedPaying)`。`churnedPaying = expired かつ stripe_customer_id あり`。
- 制約の明記: `subscriptions` は現在ステータスのみ保持（履歴なし）のため、これらは**現時点のスナップショット比**であり期間コホートではないこと。

### B-3. 流入元ごとの質 `SourceQualityTable`

`x / note / line / その他` ごとに: 登録数・トライアル数・課金数・**課金CVR%**（課金/登録）を表で。件数降順。0件チャネルは薄く表示。
→ 「どのチャネルが実際に課金まで至るか」を発信の意思決定材料にする。

### B-4. 売上/MRR `RevenueCard`

- ヘッドライン: **現MRR** = `premium × 980`（円）、**ARR** = `MRR × 12`。
- 補助: 課金者数（premium）と、可能なら `subscriptions.created_at` から**課金開始の月次推移**を簡易ライン表示。`created_at` が取得できない場合は現MRR/ARRの大きな数字のみ（推移は出さない）。実装時にカラム有無を確認して分岐する。

---

## 配置（台帳内の順序）

1. KPIカード列（既存・?定義を追加）
2. **転換率ファネル（B-1）＋ 売上/MRR（B-4）** を上部に新規追加（経営視点の要約を上に）
3. 登録推移・日別アクティブ（既存）
4. **トライアル→課金＆解約（B-2）** を課金系の近くに
5. 利用パターン・**流入元ごとの質（B-3）**・セットアップ（B-3は既存「流入元の割合」の隣）
6. 以降は既存のまま

---

## データ取得への影響

- 追加フェッチは**なし**を基本とする。すべて既存 `GET /api/admin/ledger` レスポンス（`rows`, `lpDaily` 等）から派生。
- 例外: B-4のMRR月次推移で `subscriptions.created_at` が現行レスポンスに無い場合のみ、`route.ts` の select に `created_at` を1カラム追加（読み取りのみ・RLSは既存 service_role のまま）。無ければ推移は出さない。
- 既存の try/catch（未適用テーブルは空で続行）方針を壊さない。新指標も**データ欠損時は「蓄積待ち」を表示**して落ちない。

## テスト

- `src/lib/ledger-metrics.ts` に純関数（funnel段計算、retention/churn、source別集計、MRR）を実装し、`__tests__/ledger-metrics.test.ts` を追加。
  - 境界: 母数0（ゼロ除算→0%表示）、LP訪問<登録の逆転、stripe_trialとpremiumの取り違え防止、expired×stripe有無の切り分け。
- UI部品（SectionHeading のポップオーバー開閉）は最小限の smoke テスト（任意）。

## 非スコープ（スペック②で扱う）

操作監査ログ、Stripe実照合による不整合検知、異常兆候パネル、メール表示のマスキングとCSVエクスポート警告。これらはミューテーション経路の改修・新テーブル・migration・Supabase適用を伴うため分離する。

## リスクと安全性

- 閲覧専用・既存データ派生のため本番リスクは低い。認証（`requireAdmin` メールallowlist）や `noindex` は変更しない。
- 唯一のスキーマ接触候補は B-4 の `created_at` select 追加（読み取り列1つ）。無ければ触らない。
- デプロイは既存フロー（main へ push で自動反映）。
