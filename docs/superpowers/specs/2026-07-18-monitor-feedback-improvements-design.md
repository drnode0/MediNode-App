# モニターフィードバック改善 設計（2026-07-18）

モニター2名（精神科看護師・れいこ先生）のフィードバックから、アプリ側で介入できる4項目を実装する。

## 背景

- れいこ先生: 初期設定の3択（個人/部署/プレミアム）でプレミアムが一番下にあり戸惑った。「一番上にドンとおいて誘導もあり」。専門用語がPC不慣れ層にはハードル。プレミアムの中身の濃さが一覧から伝わらない。無料体験の導線が欲しい。
- たまきさん: 「アイコンをタップすれば使える形になるのか」→ PWAホーム画面追加の説明をアプリ側に追加すると返信済み。
- 作者返信で約束済み: 説明追加・無料体験枠の拡充・充実度の可視化。

## 1. セットアップ3択の順番入替＋文言

- `SetupWizard.tsx` の start ステップ選択カード配列を「プレミアム → 個人 → 部署」に並べ替える。
- プレミアムカードに「おすすめ・設定不要ですぐ使える」バッジを付与。
- `OnboardingScreen.tsx` の「3つの知識源」も同順（プレミアム→個人→部署）に揃える。
- 専門用語（コネクトToken等）に短い補足を追加。
- 制約: `targets` の初期値 `{ personal: true, team: false, premium: false }` は handleRedo が依存するため変更しない。表示順と視覚的誘導のみ。

## 2. 「ホーム画面に追加」案内

- 新コンポーネント（バナー）: `display-mode: standalone` でない（＝未インストール）ブラウザ閲覧時のみ表示。
  - 文言例: 「📲 ホーム画面に追加するとアプリのように使えます」
  - タップで iOS Safari / Android Chrome の手順を展開。×で dismiss（localStorage 永続）。
- `help-faq.ts` に同内容のFAQ項目を追加（id: `pwa-install` 想定）。
- 注意: `sw.js` / `PwaRuntime.tsx` は別セッションのWIPのため触らない。

## 3. 一覧の充実度表示（プレミアムのみ）

- `subscription/sync/_core.ts`: 各ページの本文ブロックを取得し、以下を計算してAlgoliaレコードに追加。
  - `contentChars`: 本文テキスト文字数
  - `sectionCount`: H2見出し数
  - `headings`: H2見出しテキスト先頭5件
  - 対象は現状約37ページ。Notion API 負荷は許容範囲（cron/手動実行のみ）。
- `ResultCard.tsx`: `owner === 'subscription'` かつ `contentChars` があるカードに「📖 約N分で読める・Mセクション」バッジ（N = contentChars / 600 目安、切り上げ・最低1分）。展開時に目次（headings）を表示。

## 4. 登録時の自動トライアル（3日）

- 新API `POST /api/premium/auto-trial`（認証: Supabaseセッション）。
  - 条件: `user_metadata.auto_trial_granted_at` が未設定 かつ subscriptions にレコードが一切ない。
  - 処理: `grantTrialByUserId(user.id, 3)` → metadata にフラグ記録。
  - 既存のnote特典コード（14日）はそのまま。コード利用中/契約中ユーザーには付与しない（降格なし）。
- クライアント: ログイン確認後に fire-and-forget で呼ぶ（`/api/welcome` と同じパターン・同じ呼び出し箇所）。
- UI: トライアル中は「プレミアムを3日間無料でお試し中（〜M/D）」表示。SetupWizard のプレミアム説明を「登録するだけで3日間無料」に更新。
- 日数は固定3日（コード式の env とは独立）。

## 対象外

- 精神科特化コンテンツ（Notion側コンテンツ作業のため別途）
- App Store 配信
- 完全ログイン不要の閲覧モード（REQUIRE_LOGIN方針と矛盾するため見送り）
