# 運用ダッシュボードに「サブスク同期」ボタン

日付: 2026-07-24

## 目的
Notionのサブスク側ページを編集した直後に、スマホの `/admin`（運用ダッシュボード）から
**1タップ**でサブスク同期を走らせ、日次cron（6:00 JST）を待たずにアプリへ反映する。

## 背景 / 現状
- サブスク内容がアプリに反映される経路は2つ:
  1. Vercel Cron `/api/cron/subscription-sync`（1日1回・JST 6:00・`CRON_SECRET`）
  2. 手動API `POST /api/subscription/sync`（`x-sync-secret` ヘッダー必須 → curl前提）
- どちらもスマホから即時実行するのが難しい。編集直後に反映したいと待ち時間が発生する。
- `/admin` は既に `requireAdmin()`（login + `COMP_ADMIN_EMAILS`）でオーナー限定。
  → ログイン済みオーナーはスマホからアクセス済み。ここにボタンを置けば秘密ヘッダー不要で叩ける。

## スコープ（確定）
- **サブスク同期のみ**（サブスク用Notion DB → サブスク用Algoliaインデックス）。無料/本編の `/api/sync` は対象外。
- **1タップ即実行**（確認ダイアログなし）。同期は非破壊なので誤タップの実害は小さい。

## 構成（2ユニット）

### 1. 新API `POST /api/admin/subscription-sync`
- `requireAdmin()` でオーナー認証。不許可は 401（未ログイン）/ 403（非オーナー）。
- 中身は既存 `runSubscriptionSync()`（`_core.ts`）をそのまま await するだけ。同期ロジックは
  cron/手動APIと完全共通（二重実装しない）。
- 成功時 `{ success, synced: { medical, reference, total }, index }` を透過。
- `_core` が `{ ok:false, status, error }`（＝`'success' in result` が false）を返したら
  `{ error }` を同じ status で返す。想定外例外は 500 でJSON。
- 既存の secret 版 `/api/subscription/sync` は**残す**（cron/CI用途）。今回のは並置追加。

### 2. ボタンUI `SubscriptionSyncButton`（`DailyCommandCenter` 内）
- 🗼今日の管理カード内、`<BroadcastForm />` の直前に配置。
- 状態遷移:
  - 待機: `RefreshCw` アイコン ＋「サブスクをアプリに同期」
  - 実行中: `Spinner`・二度押し無効（`disabled`）
  - 完了: `医療◯件 / 文献◯件を同期しました`（emerald）＋ 実行時刻
  - 失敗: 赤字でエラー文（`data.error` を表示）
- 補助文言:「Notionのサブスク側を編集したら押す。毎朝6時にも自動で走ります。」
- 実装は `BroadcastForm` と同じ体裁（`useState` + `fetch` + Spinner）。

## 触らないもの
- `_core.ts` の同期ロジック、Vercel Cron、secret 版 API、Algolia側設定。
- 新規の環境変数は不要（既存 `SUBSCRIPTION_*` と `COMP_ADMIN_EMAILS` を再利用）。

## テスト
- `src/lib/__tests__/admin-subscription-sync-route.test.ts`
  - admin不許可（`requireAdmin` が `{ok:false, response}`）→ そのレスポンスを返し、`runSubscriptionSync` を呼ばない。
  - admin許可 → `runSubscriptionSync` に委譲し、その結果を 200 で返す。
  - `runSubscriptionSync` が `{ok:false,status,error}` → 同じ status で `{error}`。
  - `requireAdmin` と `_core` はモック。

## デプロイ
- 運用修正なので `main` へコミット → push で Vercel 自動デプロイ。
- env 追加なし。migration なし。

## 追記（2026-07-24）: 本文が更新されない不具合の根因と修正
**症状**: 同期ボタンを押しても、Notionで編集した本文がプレミアム・アプリ版の文書に反映されない。

**根因（systematic-debugging で特定）**: プレミアム・リーダーの本文は `/api/subscription/page` が
`unstable_cache(..., { revalidate: 3600 })`（Vercel Data Cache・**1時間**）で共有キャッシュしている。
同期ボタンが呼ぶ `runSubscriptionSync()` は **Algolia（検索メタ）だけ**を再インデックスし、この本文キャッシュ
には一切触れない。よってNotion本文の編集は最大1時間反映されない（ボタンを押しても無関係）。
※service workerは `/api/*` を素通し（無関係）。ブラウザHTTPキャッシュ(max-age=600+SWR)とクライアント
内メモリMap(10分)は短命で自己回復するため副次的。

**修正**: 本文キャッシュにタグを付け、全同期経路で `revalidateTag` によりパージする。
- `src/lib/reader-cache.ts`（新規）: `SUBSCRIPTION_READER_TAG` ＋ `revalidateSubscriptionReaderDocs()`
  （Next 16 は第2引数必須のため Route Handler 向けに `'max'` を渡す。内部実装上、profile値に依らず
  タグは `pendingRevalidatedTags` に積まれ確実に失効する）。
- `/api/subscription/page`: `unstable_cache` の options に `tags: [SUBSCRIPTION_READER_TAG]` を追加。
- 3つの同期経路（admin / secret / cron）で同期成功時に `revalidateSubscriptionReaderDocs()` を呼ぶ。

**効果**: ボタンを押す → 本文キャッシュが失効 → 次にリーダーを開くと最新Notion本文を取得。
**オーナー確認時の注意**: 押した直後は端末側の短命キャッシュ（ブラウザ10分/クライアントMap10分）で
古いまま見える場合がある。確実に確認するにはアプリを一度リロードしてから文書を開く。
