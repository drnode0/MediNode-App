# Supabase 認証メールテンプレート（原本）

ログイン／登録の確認メールの本文。**このリポジトリが原本**。ダッシュボードは検索・履歴管理がしづらいため、変更はまずここを直し、下記手順でダッシュボードに反映する。

## 方針（2026-07-15〜）

- **マジックリンクは廃止し、6桁コード一本**に統一（PWA/モバイルでリンクを押すと別ブラウザが開きアプリ側にログインされない問題の回避＋メール内リンクを減らして迷惑メール判定を下げる）。
- そのため本文に `{{ .ConfirmationURL }}`（確認リンク）は**入れない**。`{{ .Token }}`（6桁コード）だけを表示する。
- アプリ側（`LoginModal.tsx` / `app/login/LoginClient.tsx`）もコード主軸に統一済み。文言を変えるときは両者を揃える。

## ファイルと対応するSupabaseテンプレート

| ファイル | Supabaseのテンプレート | 件名 |
|---|---|---|
| `magic-link.html` | Magic Link（既存ユーザーのログイン） | `MediNode ログイン用の確認コード` |
| `confirm-signup.html` | Confirm signup（新規ユーザーの初回登録） | `MediNode アカウント登録の確認コード` |

> ⚠️ `{{ .Token }}` は必ず残す。消すとメールにコードが入らず、新規ユーザーがログインできなくなる（過去に発生）。

## 反映手順（ダッシュボード）

1. https://supabase.com/dashboard/project/jojhnouabtyxrmwwxksx/auth/templates
2. 「Magic Link」タブ → 件名を上表の通りに、本文欄に `magic-link.html` の中身を貼り付け → Save
3. 「Confirm signup」タブ → 件名を上表の通りに、本文欄に `confirm-signup.html` の中身を貼り付け → Save
4. `+alias` 宛にログインコードを送り、受信箱に届く＆コードのみのメールになっているか確認

## 送信元（参考・別設定）

- Custom SMTP = Resend（`smtp.resend.com`）、送信元 `noreply@drnode0.com`（Resendで検証済み）。
- ドメイン認証（SPF/DKIM/DMARC）は drnode0.com で設定済み・PASS。
