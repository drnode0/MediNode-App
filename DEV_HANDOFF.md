# MediNode アプリ開発 引き継ぎ書

> 次のセッション／別の開発者がアプリ開発を継続するための技術ハンドオフ。
> **本番ソースの最新実装（git最新コミット時点）から抽出した実際の表現**を記載。
> note記事・SNS投稿に関する内容は含めない（アプリ開発のみ）。
> 最終更新の基準コミット: `ffadd50 fix: 同期成功後に自動リロードしてPWAでも最新データを反映`

---

## 0. プロジェクト基本情報

| 項目 | 値 |
|---|---|
| アプリ名 | **MediNode** |
| 本番URL | https://medical-search-public.vercel.app |
| 本番リポジトリ（このフォルダ） | `/Users/tatsukinonaka/medical-search-public` |
| 開発用リポジトリ（別） | `/Users/tatsukinonaka/medical-search` |
| package.json name | `medical-search`（内部名。表示名はMediNode） |
| 一言 | 「医療知識・参考文献の高速検索」（layout/manifestのdescription） |
| 運営/販売事業者 | **Dr.Node（MediNode 運営）**（特商法ページ） |
| 解約問い合わせ先 | drnode0@gmail.com |

### 技術スタック（package.json 実値）
- **Next.js 16.2.7**（App Router）/ **React 18** / **TypeScript 5**
- **Tailwind CSS**（ユーティリティ直書き、ダークモード対応クラスあり）
- **algoliasearch 4.24** / **react-instantsearch 7.12.1**（パワーモード）
- **@notionhq/client**（Notion API、両モードで使用）
- **stripe 22.2**（プレミアム決済 Checkout + Webhook）
- ホスティング: **Vercel** / データ保存: **localStorageのみ（サーバDBなし）**
- **PWA**（manifest.json、standalone、theme_color `#2563eb`、icon-192/512）

---

## 1. ディレクトリ構成（src）

```
src/
├── app/
│   ├── layout.tsx               # metadata（title:MediNode / manifest / appleWebApp）
│   ├── page.tsx                 # ★メイン2645行。全タブ・設定・プレミアムUIを内包
│   ├── privacy/page.tsx         # プライバシーポリシー
│   ├── terms/page.tsx           # 免責事項・利用規約
│   ├── legal/page.tsx           # 特定商取引法に基づく表記
│   └── api/
│       ├── sync/route.ts                # Notion→Algolia 同期（接続テストも兼用）
│       ├── notion/search/route.ts       # シンプルモード検索（mode:'quiz'等）
│       ├── notion/genres/route.ts       # ジャンル一覧
│       ├── notion/pages/route.ts        # ページ取得
│       ├── notion/check-props/route.ts  # DBプロパティ確認（ヘルプの診断）
│       ├── notion/create-db/route.ts    # テンプレDB自動作成（NotionDbCreator）
│       ├── premium/checkout/route.ts    # Stripe Checkout（GETでtestMode判定）
│       ├── premium/verify/route.ts      # 決済後の認証
│       ├── premium/webhook/route.ts     # Stripe Webhook
│       ├── subscription/sync/route.ts   # サブスクDB同期（作者側運用）
│       ├── verify-search-key/route.ts   # Algolia Search Key動作確認（診断）
│       └── debug-index/route.ts         # Algoliaインデックス診断
├── components/
│   ├── OnboardingScreen.tsx     # 初回オンボーディング（5ページ）
│   ├── SetupWizard.tsx          # ★セットアップウィザード 1596行
│   ├── SyncPanel.tsx            # パワーモードのフッター再同期パネル
│   ├── QuizCard.tsx             # クイズの1問カード（答えを見る/隠す）
│   ├── ResultCard.tsx           # 検索結果カード＋Hit型定義
│   ├── SearchBox.tsx / SearchResults.tsx / SearchHistory.tsx
│   ├── GenreBrowse.tsx          # パワーモードのジャンルタブ
│   └── NotionDbCreator.tsx      # テンプレDBをAPIで自動生成
├── lib/
│   ├── settings.ts              # ★localStorage設定の唯一の入口
│   ├── notion.ts                # Notionクライアント/プロパティ抽出
│   └── algolia.ts               # Algoliaクライアント（個人/サブスク）
└── scripts/
    ├── sync-to-algolia.ts       # CLI同期
    └── check-year.ts
```

---

## 2. 2つの動作モード（最重要の設計軸）

`settings.searchMode` が `'notion'`（シンプル）か `'algolia'`（パワー）かで、`page.tsx`内のレンダリングコンポーネントが丸ごと切り替わる。**多くのタブUIは両モードで別コンポーネントとして重複実装されている**ので、文言修正時は両方直す必要がある。

| | シンプルモード `'notion'` | パワーモード `'algolia'` |
|---|---|---|
| バッジ表記 | 「📋 シンプルモード」 | 「⚡ パワーモード」 |
| 検索 | Notion API直接（`/api/notion/search`、600msデバウンス） | Algolia（InstantSearch、0.1秒以下） |
| 同期 | 不要（即反映、1〜3秒） | 必要（初回＋更新時に再同期） |
| 必要キー | Notion Tokenのみ | + Algolia App ID/Search/Admin Key |
| フッター | なし | `<SyncPanel />`（再同期パネル） |
| デフォルト | — | `searchMode: 'algolia'`（新規はパワー） |

---

## 3. タブ構成（page.tsx）

```ts
type Tab = 'search' | 'recent' | 'browse' | 'quiz' | 'reference'
```
画面表示順とラベル（**型の並びと表示順が違う点に注意**。文献が先・クイズが後）:

| 表示順 | id | ラベル（絵文字込み・実値） |
|---|---|---|
| 1 | `search` | `🔍 検索` |
| 2 | `recent` | `🆕 新着` |
| 3 | `browse` | `🗂 ジャンル` |
| 4 | `reference` | `📖 文献` |
| 5 | `quiz` | `🧠 クイズ` |

- 初期タブ `'search'`。**localStorage永続化なし**（リロードで検索に戻る）。
- 新着タブの日付グループ: 「今日」「今週」「今月」「それ以前」。
- 文献タブのソート: 「年 (新しい順)」「年 (古い順)」「更新日順」。

---

## 4. クイズ機能（★事実厳守：SRSは存在しない）

### 出題対象の絞り込み（page.tsx内に4箇所重複実装）
1. **要約あり**: `aiSummary + summary` をtrimして **10文字以上**
2. **知識レベル=ナレッジ**: `knowledgeLevel` に `💡` / `ナレッジ` / `knowledge` のいずれかを含む（ホワイトリスト）
3. **CQ除外**: タイトルが `❓` 始まり、または `CQ：`/`CQ:` を含むものは除外

### 出題ロジック
- **Fisher–Yatesシャッフル → 先頭20件スライスのみ**。
- 依存配列 `[quizCandidates.length]`。「シャッフル」ボタンで再シャッフル。
- **間隔反復／SRS／忘却曲線／正誤記録／復習再キューイングは一切存在しない。** 回答結果の保存もしていない。修正・説明時にここを誇張しないこと。

### QuizCard.tsx（1問の挙動）
- タイトルだけ表示 → タップで要約展開（「答えを見る」→展開、「隠す」で再折りたたみ）。
- 知識レベルのバッジ配色 `LEVEL_STYLE`:
  - `❓ クリニカルクエスチョン` = 黄、`💡 ナレッジ` = 緑、`📋 まとめ` = 青
- 要約が無いとき「要約なし」、外部リンク「Notionで開く」。

### クイズ関連の実際の文言（修正時はこの表現を踏襲）
- 空状態:「クイズがありません」「知識レベルを「💡 ナレッジ」に設定し、要約を入れるとここに出題されます」
- 案内ボックス見出し:「💡 クイズの使い方」（手順4項目）
- 補足:「❓ CQ（調査中）と 📋 まとめはクイズ除外されます」
- ヒント:「タイトルを見て内容を思い出してみましょう」／ボタン「シャッフル」

---

## 5. オンボーディング画面（OnboardingScreen.tsx）

初回のみ表示。5ページのスワイプ式。完了/スキップで `medical_search_onboarding_done_v4` を `'1'` に。
PAGES配列（id / バッジ / タイトル）:

| id | バッジ | タイトル（\nは改行） |
|---|---|---|
| `welcome` | `MediNode` | 「移動中も、当直中も\n知識はすぐそこに」 |
| `features` | `✨ できること` | 「スマホで完結\n検索から復習まで」 |
| `notion` | `📝 Notionと連携` | 「書く場所は\nそのままでいい」 |
| `dbs` | `🗂 2つのDBの役割` | 「知識本体と\n参考文献を分けて管理」 |
| `setup` | `🔑 セットアップ` | 「3ステップで\nすぐ使い始められます」 |

- `welcome`本文:「Notionの医療知識を、スマホから即座に検索・復習。\n知識と現場をつなぐ、自分だけのナレッジベース。」
- `features`の4機能:「キーワード検索」「ジャンル別ブラウズ」「クイズモード（フラッシュカードで隙間時間に反復学習）」「参考文献管理」
- `dbs`はSVGイラスト（Medical DB必須 ⇄ Reference DB任意の双方向リレーション）。
- 最終ボタン「🚀 セットアップを始める」、それ以外「次へ →」、ページ送りドット、「スキップ →」。

> ⚠️ オンボの`features`では「クイズモード」を「反復学習」と表現している。SRS無しの実装と整合させたい場合の文言検討ポイント（現状は"反復＝繰り返し解く"程度の意味）。

---

## 6. セットアップウィザード（SetupWizard.tsx）

```ts
type Step = 'mode' | 'notion' | 'algolia' | 'sync' | 'options'
type NotionSetupMode = 'choose' | 'after-template' | 'existing'
```
- パワーモード=**5ステップ**（mode→notion→algolia→sync→options）
- シンプルモード=**3ステップ**（mode→notion→options。algolia/syncをスキップ）
- ステップは数値indexでなく `setStep()` で遷移。インジケータ:「モード」「Notion」「Algolia」「同期」「オプション」。
- ヘッダー:「MediNode」「初回セットアップ」。右上「使い方」（オンボ再表示）「ヘルプ」（ステップ別ヘルプ）。

### Notionステップの要点（実際の表現）
- Token入力:「コネクトToken *」「（`ntn_` または `secret_`で始まる文字列）」
- 用語統一:**「コネクト（旧称: Integration / インテグレーション）」** という言い回しで一貫。
- 取得導線:「notion.so/my-integrations → 「新規コネクト」→ 認証方法「アクセストークン」→ 作成後に「アクセストークン」をコピー」
- DBの選び方サブ画面（choose）:「📋 テンプレートを複製して使う」（推奨）/「🔗 既存のDBに連携する」
- **テンプレURL（ハードコード・唯一）**:
  `https://app.notion.com/p/MediNode-DB-37afd756737080ba8035f2cdb33af355`
- DB ID抽出は `extractNotionDbId`（settings.ts）。32桁hex / ハイフン付きUUID / URLに対応、`?v=`除去。

### プロパティ要件（ヘルプ＆既存DB画面の表）
**Medical DB（メイン・必須）**: `名前`(タイトル) / `要約`(テキスト) / `キーワード`(テキスト) / `ジャンル`(マルチセレクト) … すべて**完全一致必須**。`知識レベル`(セレクト)=推奨（クイズで使用）。
**Reference DB（任意）**: 必須=`名前`/`要約`/`キーワード`、推奨=`発行年`(日付or数値)/`ジャンル`、任意=`著者`/`ジャーナル名`/`エビデンスレベル`。
- 警告の定番表現:「⚠️ **名前が異なると**同期・検索が正しく動作しません（例: 「要約」を「サマリー」に変えるとNG）」
- **ウィザードにライブなプロパティ存在チェックは無い**（非空チェックのみ。正否は`/api/sync`がサーバ側で判断、ヘルプ画面の「DBプロパティ確認」=`/api/notion/check-props`で診断）。

### 同期ステップ
- 接続テスト「🔌 接続テスト（推奨）」=`/api/sync` に `testOnly:true`（1件取得）。本同期「同期開始」。
- 完了画面に「⚠️ ご注意（端末ごとのlocalStorage保存）」「🔒 このアプリのURLについて（第三者共有注意）」の固定注記あり。

### オプションステップ
- 部署用DB（任意・折りたたみ）、プレミアム（任意・折りたたみ）。
- 完了ボタン「設定を保存して検索を開始する →」/「スキップして検索を開始する」。

---

## 7. 設定パネル（page.tsx 内 `SettingsPanel`）

ボトムシート、見出し「⚙️ 設定」。`section` ステートでサブ画面分岐:
- メインメニュー項目:「🔗 Notion・Algolia接続設定」「🏥 部署DB設定」「⭐ プレミアムDB設定」「🔀 モードを変更する」「📋 NotionDBをセットアップする」
- サポート:「📘 セットアップ＆運用ガイド」(外部 `https://app.notion.com/p/378fd756737081a2bc23f1acb5f3a4bc`)「📖 ヘルプ・よくあるエラー」
- その他:「🔄 セットアップをやり直す」（設定保持）「🗑 設定を完全に削除する」
- 確認ダイアログ（section）:`redo-confirm` / `reset-confirm` / `mode-confirm` / `db-setup-confirm`

### ヘルプ画面（section='help'）の診断ツール
- 「🔄 同期エラーが出たときは」（API token invalid / restricted_resource・403 / Admin Key）
- 「⚠️ プロパティ名について」（プロパティ名は変更しない、選択肢追加は自由）
- 「🔍 DBプロパティ確認」→ `/api/notion/check-props`（「✅ 全て一致」「⚠️ 不一致あり」）
- パワーモードのみ:「🔑 Search Key動作確認」→ `/api/verify-search-key`、「🔬 Algoliaインデックス診断」→ `/api/debug-index`
- 「📱 別のデバイスで使うには」（localStorageはこのブラウザのみ、再入力が必要）

---

## 8. プレミアム（Stripe）

- 価格表記:「月額 ¥980（税込）」「いつでも解約できます」。
- 未契約でプレミアムタブ→`SubscriptionPromoPanel`（串刺し検索の訴求／対象13職種タグ／免責）。
- 購入ボタン:「⭐ 月額¥980で登録する →」→ `POST /api/premium/checkout` の `url` へ遷移。
- **テスト決済**: `GET /api/premium/checkout` の `testMode`（Stripe Secret Keyが`sk_test_`時true）で `TestModeNotice`「🧪 これはテスト決済です」＋テストカード `4242 4242 4242 4242` 案内。
- 決済完了: URLパラメータ `?premium_session=` → `POST /api/premium/verify` → 成功で2秒後 `reload()`。
- 解約案内 `PremiumCancelInfo`:`portalUrl`有→「Stripeカスタマーポータルで解約する →」、無→ メール（drnode0@gmail.com）案内。
- オーナーフィルタ（`OwnerFilterTabs`）:`all`「全て」/`personal`「個人」/`team`「部署」/`subscription`（契約済「⭐ プレミアム」・未契約「🔒 プレミアム」）。

---

## 9. localStorage キー一覧（永続化の全体像）

| キー | 定義 | 用途 |
|---|---|---|
| `medical_search_settings` | settings.ts `STORAGE_KEY` | 全設定（AppSettings）。`getSettings/saveSettings/clearSettings` |
| `medical_search_setup_draft` | settings.ts `DRAFT_KEY` | ウィザード入力中の一時保存（キーストロークごと） |
| `medical_search_last_synced` | settings.ts `LAST_SYNCED_KEY` | 最終同期ISO日時。`formatLastSynced`で「○分前」表示 |
| `medical_search_onboarding_done_v4` | page.tsx `ONBOARDING_DONE_KEY` | オンボ完了フラグ |
| `medinode_power_banner_dismissed_v1` | page.tsx `POWER_BANNER_DISMISS_KEY` | パワーモード誘導バナーを閉じた |

`AppSettings` フィールド（settings.ts）: `searchMode` / `notionToken` / `notionMedicalDbId` / `notionReferenceDbId` / `algoliaAppId` / `algoliaSearchKey` / `algoliaAdminKey` / `algoliaIndex`(既定`medical_knowledge`) / `teamLabel` / `teamNotionToken` / `teamNotionMedicalDbId` / `teamNotionReferenceDbId` / `subscriptionSearchKey` / `subscriptionAppId` / `subscriptionIndex` / `propSummary` / `propKeywords` / `propKnowledgeLevel` / `propGenre`

> `propSummary/Keywords/KnowledgeLevel/Genre` はAppSettingsに存在するが**ウィザードにUI入力欄が無い**（空のままサーバ既定にフォールバック）。プロパティ名カスタマイズUIを作るなら接続ポイントはここ。

---

## 10. SyncPanel（パワーモードのフッター再同期）

- 「🔄 データを再同期する」トグル＋「最終同期: ○分前」。`/api/sync` を叩く。
- エラー分類（実装済み）: Notion Token無効 / DB ID不在(404) / 権限(403) / Algoliaキー / ネットワーク。
- **成功後 1.5秒で `window.location.reload()`**（PWAで手動リロードしづらく古いAlgolia結果が残る問題への対処。最新コミットの肝）。
- 部署DB併用時は「個人/部署」の件数内訳も表示。

---

## 11. 法的ページ・メタ

- `/legal` 特定商取引法：販売事業者「Dr.Node（MediNode 運営）」、販売価格あり。
- `/terms` 免責事項・利用規約、`/privacy` プライバシーポリシー。アプリ各所からリンク。
- `layout.tsx`: title「MediNode」/ description「医療知識・参考文献の高速検索」/ manifest / appleWebApp.title「MediNode」。
- `manifest.json`: standalone、theme_color `#2563eb`、background `#ffffff`、icon-192/512（maskable）。

---

## 12. 開発時の注意・既知の論点

1. **両モード重複実装**: 検索/新着/文献/クイズの文言・ロジックは `'notion'` 用と `'algolia'` 用で別々に書かれている。**片方だけ直すと不整合**になる。
2. **クイズはSRS無し**（§4）。UI文言で「復習」「反復」を使う際は機能と乖離しないよう注意。
3. **用語**: Notionの「コネクト（旧称: Integration）」表記で統一済み。新規文言も合わせる。
4. **プロパティ名は完全一致必須**（型は柔軟）。検証はサーバ側＋ヘルプの診断ツール。
5. **データは全てlocalStorage**。端末間同期なし＝「別デバイスは再入力」の案内が各所にある。
6. **テンプレURL・運用ガイドURL・サポートメール**はハードコード。差し替え時は §6/§7 の箇所を更新。
7. リポジトリが2つ（`medical-search` と `medical-search-public`）。**本番は `-public`**。どちらを編集するか最初に確認。

---

## 13. 次セッションの着手手順（推奨）

1. このファイル（`DEV_HANDOFF.md`）を最初に読む。
2. 編集対象が本番(`-public`)か開発(`medical-search`)か確認。`git log --oneline -5` で最新状態を把握。
3. 文言修正なら **シンプル/パワー両系統** を `page.tsx` 内でgrepして両方直す。
4. 動作確認: `npm run dev`。プレミアムはStripeテストキーで `4242...` カード。
5. クイズ/プロパティ/同期に触れる場合は §4・§6・§10 の事実を厳守。
