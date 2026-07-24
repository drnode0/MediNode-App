# 運用ダッシュボード：エンゲージメント・継続の監視

日付: 2026-07-24

## 目的
「売れているか」だけでなく **「使われ続けているか」** を運用ダッシュボードで把握する。
具体的な要望:
- アクティブ会員かどうか（会員のうち実際に使っている割合）
- 今日／昨日の**ユニーク**使用人数（のべではない）
- コンテンツ充実期に監視すべき指標一式

## 前提（既存の計測基盤・作り直さない）
- `app_usage_daily(user_id, used_on)`：主キー `user_id+used_on` = **構造的にユニーク**。行数=その日のユニーク使用者数。
- `app_usage(user_id, last_used_at)`：最終利用日時。
- `subscriptions(status, plan, has_premium, tier)` ＋ `deriveMemberKind()` で会員種別を判定（ledgerと同一定義）。
- `daily_question_log(user_id, answered_on)`：今日の1問の回答日ログ。
- `cq_views(object_id, view_count)`：解決CQの参照回数（誰が、は保存しない）。
- `push_subscriptions(user_id, endpoint, revoked_at)`：Web Push購読・失効。
- 既存グラフ部品 `AdminCharts`（DailyBarsChart / ActiveBreakdownBar / 汎用帯）。

## プライバシー方針（維持）
日付・件数のみ集計。誰が何を検索/閲覧したかは扱わない。`cq_views` は object_id 単位の
のべ回数のみ（個人紐付けなし）。

## 配置
- **🗼今日の管理（DailyCommandCenter）** … 毎日スキャンする“頭出しの数字”のみ。
- **📊分析・マーケ タブ（AdminLedgerClient 内）** … 新セクション「エンゲージメント・継続」で深掘り。

## アーキテクチャ（既存パターン踏襲）
- 新API `GET /api/admin/engagement`（`requireAdmin`）。8系統を best-effort で1JSONに集約
  （1つ失敗しても他は返す。テーブル未適用でもnull/0で劣化）。
- 純粋集計は `src/lib/engagement-metrics.ts` に分離（DB I/Oはroute、計算はlib＝fixtureでテスト可能）。
- クライアントは分離fetch：DailyCommandCenter は `/api/admin/daily` に加えこのAPIも呼ぶ。
  分析タブは AdminLedgerClient から呼ぶ。重い ledger を待たせない。
- JST日付は既存 `jstDateKey(now)` を再利用（`Date.now()` は route で1回だけ取得しlibへ渡す）。

## 指標定義（母数まで確定）

### A. 🗼今日の管理・新「利用状況」行（数字タイル）
| 指標 | 定義 |
|---|---|
| 今日のユニーク使用者 | `app_usage_daily` の `used_on = jstDateKey(now)` の件数 |
| 昨日のユニーク使用者 | `used_on = 昨日` の件数 |
| 7日平均/日 | 直近7日の日次件数の平均（基準線・四捨五入） |
| **会員稼働率** | 有効会員（kind ∈ {premium, stripe_trial, trial, auto_trial}）のうち `last_used_at` が **7日以内** の割合。表示「稼働 ◯/◯人（◯%）」＝実数併記 |

### B. 📊分析・「エンゲージメント・継続」新セクション
- **スティッキネス**：DAU(今日) / MAU(直近30日ユニーク) を %。実数併記。
- **継続日数の分布（直近7日）**：ユーザーごとの利用日数を 1日／2〜3日／4〜6日／毎日(7) に分類した帯。
  ＋**リピーター率** = (利用日数≥2の人) / (≥1の人)。
- **復帰と離脱（週次）**：今週アクティブ ◯人 ＝ 継続(先週も使った)◯／新規・復帰(先週なし)◯。
  ＋**離脱注意** = 先週アクティブ・今週0回 ◯人。週境界は直近7日 vs その前7日（JST）。
- **今日の1問 回答率**：今日の回答者数 / 今日の使用者数（%）＋直近7日回答者数。
- **コンテンツ反応**：解決CQ参照 **上位10**（`cq_views` view_count 降順）。object_id→タイトルは
  既存の解決CQ取得経路（Algolia/Notion）で解決。取れなければ object_id を短縮表示。
- **Push健全性**：有効購読者数（distinct user_id, revoked_at is null）／オプトアウト率
  （失効した人 / 一度でも購読した人）／直近配信（`push_broadcasts` 最新 sent/pruned）。

## 純粋関数（engagement-metrics.ts・テスト対象）
- `countUsageOn(dailyRows, dateKey): number`
- `avgDailyUnique(dailyRows, last7Keys): number`
- `memberActiveRate(members: {kind, lastUsedAt}[], nowMs, days=7): {active, total, pct}`
- `stickiness(dauToday, mau): number`（%・mau=0で0）
- `continuityDistribution(dailyRows, last7Keys): {buckets:{d1,d2_3,d4_6,daily}, repeaterRate}`
- `weeklyRetention(dailyRows, thisWeekKeys, lastWeekKeys): {thisWeekActive, continuing, newOrReturning, churnRisk}`
- `pct(part, whole): number`（既存 ledger-metrics に同名あり→再利用 or ローカル）
- `optOutRate(everSubscribed, revoked): number`

## 但し書き（UIに小さく明記）
- `app_usage_daily` は 0006 適用日以降のみ蓄積 → MAU・週次は立ち上がり期間がある。
- ping は1日1回・best-effort ＝ **実利用の下限**（過小評価側）。
- 会員数が小さい現状は % が振れる → **必ず実数併記**。
- 「新着公開→活性変化」の相関は今回見送り。日別アクティブ推移のイベント縦線（既存機構）で目視相関。v2候補。

## テスト
- `src/lib/__tests__/engagement-metrics.test.ts`：各純粋関数を fixture で（境界＝0件/未適用/週跨ぎ/同一ユーザー複数日）。
- `src/lib/__tests__/admin-engagement-route.test.ts`：requireAdmin不許可→401/403、許可→集約JSON、
  一部テーブル失敗でも他フィールドは返る（best-effort）。Supabase/guardはモック。

## デプロイ
- 運用機能なので `main` へ。env追加なし。**migration追加なし**（既存テーブルのみ使用）。
- 前提: 0006/0007/0012/0014/0016 適用済み（未適用フィールドは0/リンク劣化で安全）。
