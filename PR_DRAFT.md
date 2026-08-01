<!--
コピペ用 PR 下書き（コミットしない・GitHub の compare 画面に貼り付けて使う）
base: main  ←  compare: feature/privacy-policy-settings-sync
compare URL: https://github.com/drnode0/medical-search-template/compare/main...feature/privacy-policy-settings-sync

【PRタイトル】
feat(auth): ログイン基盤・アクセス制御ゲート・オンボーディング入口・privacy/terms改訂

↓↓↓ ここから下を PR 本文（Description）に貼り付け ↓↓↓
-->

## 概要

設定の端末間同期（SettingsSync・PR #1 でマージ済み）を前提に、**ログイン導線の整備**・**アクセス制御ゲート**・**オンボーディング入口の二択化**・**法務ページ（privacy/terms）の実態反映**をまとめて入れる。

REQUIRE_LOGIN は環境変数フラグで、**未設定/`true`以外なら従来通り（OFF）**。本PRをマージしてもログイン必須化は発動しない（Vercel に env を投入した時点で初めて有効）。

## 主な変更

### 1. ログイン導線
- オンボーディング・初回設定にログイン入口／設定復元の誘導を追加（`b5f675b`）。
- 専用ログインページ `/login` を新設（マジックリンク＋6桁OTP、`?next` で元ページ復帰・オープンリダイレクト対策込み）（`4f86ef8`）。

### 2. アクセス制御ゲート（REQUIRE_LOGIN）
- `proxy.ts` に環境変数 `REQUIRE_LOGIN` ゲートを実装。`true` のとき未ログインを `/login` へリダイレクト。
- 公開パス：`/login` `/auth` `/privacy` `/terms` `/legal`、およびルート `/`（未ログインでもオンボーディング＋入口分岐を見せるため）。
- **未設定/`true`以外なら挙動は一切変わらない。**

### 3. オンボーディング入口の二択化（`7f15d03` / `178c041`）
- オンボーディング（アプリ紹介）→ セットアップ冒頭に**入口分岐 `entry`** を新設。
  - 🅐 アカウントをお持ちの方 → メール認証だけでログイン→設定が同期復元されて即完了。
  - 🅑 はじめて使う方 → 従来通りのDB設定。
- **新規ユーザーのメール登録を必須化**：設定完了時に未ログインなら登録モーダルを必ず通過。
- 重複していたログイン導線（start内の緑バナー／オンボーディング上部の案内）を入口に一本化。
- 入口分岐が初回に出ず `start` へ直行していた不具合を修正（`setupInitialStep` 既定を `entry` に）。

### 4. 法務ページの実態反映
- **privacy**（`3abc227`）：ログイン中の設定（Notionトークン等の機密含む）を AES-GCM で暗号化してサーバー保存・端末間同期する実態を明記。データと暗号鍵の分離保管、未ログイン時はサーバー非送信であることも記載。
- **terms**（`594bf5e`）：第5条「アカウント・ログインについて」を新設（アカウント登録／パスワードレス認証／本人管理責任／違反時の利用停止）。
- 保存先の説明文（「このブラウザのみに保存」等）をログイン前提の文言に統一し、privacy と矛盾しないよう修正（`178c041`）。

### 5. 告知バナー
- 設定の端末間同期の告知バナーを追加（`39c7537`）。

## 含まれるコミット（9件）
- `39c7537` feat(announce): 設定の端末間同期の告知バナーを追加
- `2faa35c` fix(auth): ログイン説明文をSettingsSync後の実態に更新
- `b5f675b` feat(auth): オンボーディング/初回設定にログイン導線を追加
- `f57be38` Merge origin/main into feature/login-entrypoints
- `3abc227` docs(privacy): SettingsSyncの実態に合わせてプライバシーポリシーを改訂
- `4f86ef8` feat(auth): ログイン必須ゲート(REQUIRE_LOGIN)と専用ログインページを追加
- `594bf5e` docs(terms): ログイン必須化に備えアカウント・ログイン条項を追加
- `7f15d03` feat(onboarding): セットアップ入口にアカウント有無の二択を追加
- `178c041` fix: 入口分岐を初回から表示＋保存先の説明をログイン前提に統一

## ⚠️ マージ・デプロイ手順（順番厳守・すべてオーナー操作）
> 今回のデプロイから**ログイン必須化（`REQUIRE_LOGIN=true`）も同時に有効化**する方針。①②③を時間差なく揃える。
- [ ] ① モニターへ「今回からログイン必須」連絡（Notion文面🅐🅑）。連絡前に②③を先行しないこと。
- [ ] ② このPRをマージ → 自動デプロイ（バナー・/login・入口二択・privacy/terms が入る。**この時点ではまだ必須化は未発動**）。
- [ ] ③ Vercel に `REQUIRE_LOGIN=true` を投入 → **ここで初めてログイン必須化が発動**。
- [ ] ④ 動作確認：未ログインで `/login` へ／ログイン後にローカル設定が残る／別端末で引き継げる。
- [ ] `SETTINGS_ENC_KEY` は投入済み（PR #1 時）。既存モニターの設定はログイン後 SettingsSync が自動アップロード＝入れ直し不要（検証済み）。

## 検証
- `npx tsc --noEmit`（エラー0）／`npm run build`（成功・`/login` `/privacy` `/terms` 静的生成・Proxy Middleware 認識）。
- `REQUIRE_LOGIN=true` 実機検証：`/`→200、`/settings`→307→`/login?next=...`、`/login` `/privacy` `/terms`→200（無限リダイレクトなし）。
- オンボーディング→入口分岐が初回から表示されることを実機確認。
