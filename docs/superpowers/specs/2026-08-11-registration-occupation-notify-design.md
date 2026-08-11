# 登録フローの職種ステップ＋通知オプトイン 設計

日付: 2026-08-11
状態: 承認済み（tatsuki・本会話でQ&A確定）

## 目的

1. **職種をアカウントに紐づける** — どんな職種の読者がいるかをナレッジ作りの参考にする（/admin集計）。CQ投稿時の職種入力を不要にする。端末を替えても引き継がれる。
2. **登録の流れの中で通知をONにできるようにする** — 現状、通知が実際に届くには端末購読（ブラウザ許可＋subscribe）が必要だが、設定→通知まで自分で行かないと起きない。登録直後に1タップで購読できる導線を作る。

## 決定事項（Q&Aで確定）

- 職種は**認証成功後の必須ステップ**として訊く（メール入力前には訊かない）。
- 登録時に訊くのは**職種のみ**（うるささ回避）。経験年数・診療科・立場は従来どおりCQ投稿の初回に訊く。
- なぜ訊くかを一文添える（静かな文言。例:「どんな職種の方が読んでいるかを、今後のナレッジ作りに活かします」）。
- 通知は**職種の次の独立ステップ**。「通知を受け取る」ボタン＋「あとで」でスキップ可（通知は強制不可のため）。
- **既存ユーザーも次回ログイン時**に職種未登録なら同じステップを一度だけ出す。
- 実装は**案A: LoginModal のフェーズ機械を拡張**（全入口で共用されているため1箇所で効く）。

## 設計

### 1. データ

- migration `0024_user_occupation.sql`: `alter table public.user_settings add column if not exists occupation text;`
  - 既存migration（0009等）と同様、列が無くてもコードが動く追加のみの変更。Supabase SQL Editorで手動適用。
- 値は `CQ_OCCUPATIONS`（src/lib/cq-submit.ts の固定15択）のみ許可。サーバー側で検証。

### 2. API

`src/app/api/account/profile/route.ts`（新規）

- `GET`: ログイン本人の `{ occupation: string | null }` を返す。未ログインは401。
- `POST`: `{ occupation }` を保存。リスト外の値は400。未ログインは401。
- 実装は `user_settings` への upsert。既存の early_access 系の照会コードの流儀に合わせる。

### 3. LoginModal のフェーズ拡張

`email → sent → profile → notify → done`

- **認証成功時（verifyCode / signInWithPassword）**: `GET /api/account/profile` で職種を照会。
  - 未登録（null）→ `profile` フェーズへ。
  - 登録済み → `notify` 判定へ（下記）。
- **profile フェーズ**:
  - 職種の1タップ選択（`CQ_OCCUPATIONS` のチップ型ボタン。CqCaptureの選択UIの見た目に合わせる）。
  - CQ投稿で端末に記憶済みの職種（`CQ_PROFILE_KEY`）があれば選択済み状態で表示。
  - 選択→保存成功で次へ。保存失敗はエラー表示＋再試行（現行のエラー表示流儀）。
  - 「なぜ訊くか」の一文を添える。スキップボタンは置かない（必須）。ただしモーダル自体は閉じられる（閉じたら保存せず終了→次回ログイン時に再度出る）。
- **notify フェーズ**:
  - この端末が購読済み（`getDeviceSubscribed()`）ならこのフェーズは出さず `done` へ。
  - 「通知を受け取る」ボタン → `subscribeThisDevice()`（許可ダイアログ発火）。結果メッセージは PushSettings の `deviceResultMessage` を共用（iPhone非PWAの「ホーム画面に追加」案内を含む）。
  - 「あとで」→ `done` へ。購読成功時も結果表示→`done` へ。
  - 文言はコピー方針（静かな日本語）に従う。通知の内容（今日の1問・解決CQ・お知らせ）を一行で示す。
- **done フェーズ**: 現行のまま。

補足: サーバー側 prefs は既定で master:true のため、prefs の操作は登録フローでは行わない（端末購読だけが足りないピース）。

### 4. CQ投稿への接続（CqCapture）

- 職種の初期値: **アカウント（GET /api/account/profile）→ 端末記憶（CQ_PROFILE_KEY）** の優先順。アカウントに職種があれば職種選択UIは畳んで表示（変更は可能なまま）。
- 投稿確定時、アカウント側が未登録なら選択された職種を `POST /api/account/profile` で保存（穴埋めの裏ルート。失敗しても投稿は成功扱い）。

### 5. /admin

- 台帳に「職種の内訳」の小さな集計枠を1つ追加（user_settings.occupation の group by。未登録は「未登録」として表示）。
- 置き場所は既存の利用者系グラフの並び。新規APIは既存 admin API に相乗りできるならそちらへ。

### 6. テスト

- profile API のバリデーション（リスト外400・未ログイン401・正常保存）のユニットテスト。
- LoginModal のフェーズ分岐はロジックを純関数に切り出せる範囲で単体テスト（例: 認証後の遷移先判定 `nextPhaseAfterAuth(occupation, subscribed)`）。
- 実機目視（登録フロー一巡・iPhone PWA/非PWAの通知ステップ）はオーナーに依頼。

## 実装の進め方

- memory の教訓どおり **worktree を切って実装**（shared-worktree-branch-collision）。ブランチ名: `feat/signup-occupation-notify`。
- migration 0024 は Supabase SQL Editor での手動適用が必要（デプロイ後の残タスクとして明記する）。
