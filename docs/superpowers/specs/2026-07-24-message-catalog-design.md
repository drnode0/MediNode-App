# 運用ダッシュボード：通知・表示カタログ（見える化）

日付: 2026-07-24

## 目的
アプリがユーザーに出している通知・表示（Push／画面バナー／モーダル／静かなNew・バッジ／設定内）が
散らばっていて全体像が掴めない。まず **「何が・どこで・どの条件で・今ON/OFFか」を1枚で見える化**する。
自由な操作（即ON/OFF・優先度制御）は次段。今回は phase1＝可視化に徹する。

## 背景（4棚卸しの統合結果・全22〜24種）
- **Push実弾は2つだけ**：今日の1問（cron・段階フラグ）／お知らせ一斉送信（オーナー手動）。
  `resolved_cq` は設定トグルがあるが**送信コードが無い＝死にチャネル**。
- **画面バナー**は page.tsx にDOM順で積む（PWA導入/お知らせ更新/解決CQ/筆者追加/FB依頼/パワーモード）。
  優先度の仕組みは無く、DOM順＋「解決CQバナー中は筆者ダイジェストを出さない」の1ルールのみ。
- **静かな通知**（筆者追加3層/参照回数バッジ/収録レベル/由来/日付グルーピング）は
  Notionプロパティ＋localStorage透かしで**全自動**、/adminトグル無し。
- **オーナーがランタイム操作できるのは3つだけ**：`app_flags` の maintenance / daily_question / push
  （AdminSettingsPanel の段階トグル）＋お知らせ一斉送信。残りは**ハードコード or localStorage**。
- **env罠**：`PUSH_STAGE` / `DAILY_QUESTION_STAGE` が設定されていると**管理UIより優先**される。

## 要注意3件（今回は⚠表示のみ・修正は別途）
1. お知らせバナーがハードコード（`ANNOUNCEMENTS[]`＝毎回コード編集＋再デプロイ）。
2. 解決CQ push が死にチャネル（トグルはあるが送信元なし）。
3. env（`PUSH_STAGE`等）が管理UIを上書きする罠。

## 配置
`/admin` に **専用タブ「📣 通知・表示」を新設**（5つ目・`AdminTab` に `messages` 追加）。

## アーキテクチャ
- **レジストリ** `src/lib/message-catalog.ts`：全項目を型付き配列 `MESSAGE_CATALOG` で定義。
  これが唯一の一覧の真実（＝後で操作機能を足す土台）。純粋関数 `summarizeCatalog()` で
  カテゴリ別件数と要注意件数を出す（テスト対象）。
- **ライブ状態API** `GET /api/admin/message-status`（requireAdmin）：`app_flags` 3キーの
  実状態を返す。`readMaintenanceFlag()/readDailyQuestionStage()/readPushStage()` を再利用。
  さらに `PUSH_STAGE`/`DAILY_QUESTION_STAGE` の env上書きが効いているかを boolean で返し、
  env罠を**ライブ⚠**として表示できるようにする。
- **画面** `src/app/admin/MessageCatalog.tsx`（client）：カテゴリ別カード。
  列＝名前／どこで／出る条件／頻度／現在の状態／操作可否。
  `flag` を持つ項目は状態バッジ（ON/preview/OFF）を実表示し、既存トグル（配信・設定タブ）へ誘導。
  `health` を色で明示（dead=赤／hardcoded=琥珀／env-override=琥珀ライブ／preview-locked=情報色）。
- タブは `AdminLedgerClient` の `ADMIN_TABS` に追加、`{tab==='messages' && <MessageCatalog/>}`。

## データモデル
```ts
type MessageChannel = 'push' | 'banner' | 'modal' | 'quiet' | 'settings'
type Health = 'ok' | 'hardcoded' | 'dead' | 'env-override' | 'preview-locked'
type CatalogItem = {
  id: string; name: string; channel: MessageChannel
  where: string; trigger: string; frequency: string; control: string
  controllable: boolean                    // オーナーがランタイム操作できるか
  flag?: 'maintenance' | 'daily_question' | 'push'  // ライブ状態を出す対象
  storageKeys?: string[]; file?: string
  health?: { level: Health; note: string }
}
```

## テスト
- `message-catalog.test.ts`：id一意・`flag`値が3種のいずれか・`summarizeCatalog` の集計（カテゴリ別件数／要注意件数）・少なくとも既知の要注意3件が health 付きで存在。
- `admin-message-status-route.test.ts`：requireAdmin不許可→401/403、許可→3フラグ＋env上書きboolean。read関数はモック。

## 触らないもの
実際の通知/バナーの挙動・トリガーロジック・app_flags書き込みAPI。今回は**読むだけ**（新規の書き込み無し）。

## デプロイ
`main` へ。env追加なし・migration無し（既存 app_flags のみ参照）。
