# 🏥 Medical Search

NotionのデータベースをAlgoliaで高速検索するWebアプリです。
URLを開いて手順通りに進めるだけで、自分のNotionデータベースの検索環境が構築できます。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdrnode0%2Fmedical-search-template)

---

## ✨ 機能

- 🔍 **高速全文検索** — Algoliaによるリアルタイム検索
- 🆕 **新着タブ** — 今日・今週・今月別に表示
- 🗂 **ジャンル別ブラウズ** — カテゴリで絞り込み
- 📖 **参考文献タブ** — 発行年・更新日でソート
- 🧠 **クイズタブ** — 知識確認に
- ⚙️ **アプリ内セットアップ** — URLを開いて手順通りに進めるだけ

---

## 🚀 セットアップ手順

### 必要なもの（すべて無料）

| サービス | 用途 | 登録リンク |
|---------|------|-----------|
| Notion | データベース | [notion.so](https://www.notion.so) |
| Algolia | 検索エンジン | [algolia.com](https://www.algolia.com) |
| Vercel | アプリのデプロイ | [vercel.com](https://vercel.com) |

---

### Step 1: Notionテンプレートを複製する

→ **[📋 Notionテンプレートを複製する]**（リンクは別途案内）

複製後、テンプレートのDBに自分の医療知識を入力してください。

---

### Step 2: Notion Integrationを作成する

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) にアクセス
2. 「新しいインテグレーション」を作成
3. 表示される **Integration Token（`secret_`で始まる文字列）** をメモ
4. DBページ右上「…」→「接続先に追加」→ 作成したIntegrationを選択
5. DBのURL `https://www.notion.so/xxxxxxxx...` の32文字部分が **DB ID**

---

### Step 3: Algoliaアカウントを作成する

1. [algolia.com](https://www.algolia.com) でアカウント作成（無料）
2. ダッシュボード → **Settings → API Keys** を開く
3. 以下の3つをメモ：
   - **Application ID**
   - **Search-Only API Key**
   - **Admin API Key**

---

### Step 4: Vercelにデプロイする

1. 上の **「Deploy with Vercel」ボタン** をクリック
2. GitHubアカウントでログイン（または新規作成）
3. リポジトリ名を入力 → **Deploy**
4. デプロイ完了後、表示されたURLを開く

> 環境変数の設定は**不要**です。アプリ内で入力できます。

---

### Step 5: アプリ内セットアップ

デプロイしたURLを開くと自動的にセットアップ画面が表示されます。

1. **Notion設定** — Integration TokenとDB IDを入力
2. **Algolia設定** — App ID・各APIキーを入力
3. **同期** — 「同期開始」ボタンをクリック → 完了🎉

---

## 📁 Notionデータベースのスキーマ

### Medical DB（医療知識）

| プロパティ名 | 種類 | 説明 |
|------------|------|------|
| 名前 | タイトル | 知識のタイトル |
| ジャンル | セレクト | 大分類 |
| 詳細ジャンル | セレクト | 小分類 |
| タグ | マルチセレクト | キーワードタグ |
| 知識レベル | セレクト | レベル分類 |
| AI要約 | テキスト | 内容の要約 |
| キーワード | テキスト | 検索用キーワード |

### Reference DB（参考文献）※任意

| プロパティ名 | 種類 | 説明 |
|------------|------|------|
| 名前 | タイトル | 文献タイトル |
| 著者 | テキスト | 著者名 |
| ジャーナル名 | セレクト | 掲載誌 |
| 発行年 | 日付 | 発行年月日 |
| エビデンスレベル | セレクト | EBMレベル |
| キーワード | テキスト | 検索用キーワード |

---

## 🔄 データの再同期

Notionのデータを更新した後は再同期が必要です。

1. アプリ右上の ⚙️ ボタン → 「リセット」
2. セットアップ画面から再度「同期開始」

---

## 🛡 セキュリティについて

- 入力したAPIキーは**お使いのブラウザのみ**に保存されます
- 外部サーバーには保存・送信されません
- 別のデバイスからアクセスする場合は再入力が必要です

---

## 📄 ライセンス

MIT
