# MediNode 開発引き継ぎ帳

**最終更新**: 2026-06-11（第11セッション・プレミアム訴求強化＝串刺し検索の価値・Notionジャンプ・価格¥980明記）
**プロジェクトパス**: `/Users/tatsukinonaka/medical-search-public`
**デプロイ先**: https://medical-search-public.vercel.app
**Vercelプロジェクト**: `tnonaka1101-stacks-projects/medical-search-public`
**GitHubリポジトリ**: `drnode0/medical-search-template`（Vercel自動デプロイ接続済み・`main`ブランチ）

---

## 🚀 次セッション開始用プロンプト（そのままコピペ）

```
MediNodeという医療知識管理アプリの開発を続けます。
プロジェクトパスは /Users/tatsukinonaka/medical-search-public です。
まず HANDOFF.md を読んで全体の背景・現状・未完了タスクを把握してください。

前回（第11セッション）でプレミアム会員の訴求を強化しました。プロモパネル（SubscriptionPromoPanel）と
設定のプレミアム登録画面の両方に、「自分のNotion DBと医師の公開ナレッジをツール切替なしで串刺し（横断）検索
できる」という最大の強み、共有Notionページへのジャンプ、月額¥980（税込）・いつでも解約可能を明記しました。
さらに「こんな方におすすめ」職種タグを全14職種（医学生〜救急救命士）に拡充し、
「救急・集中治療は多職種が連携するチーム医療」という訴求を（うるさくならない範囲で）強化しました。
最新コミット: 9e939f5

今日やりたいこと：（未完了タスクリストを参照）
```

**デプロイの仕組み（第5セッションで確立）**: `git push origin main` すると
`drnode0/medical-search-template` 経由でVercelが自動デプロイする。手動デプロイは不要。

---

## アプリ概要

Notionに蓄積した医療知識・参考文献をスマホから高速検索・復習できるWebアプリ。

- **技術スタック**: Next.js 16.2.7 (App Router) + TypeScript + Tailwind CSS
- **検索エンジン**: Algolia（パワーモード）または Notion直接（シンプルモード）
- **設定保存**: デバイスごとの localStorage（サーバーにキー保存なし）

### コアバリュー

Notionのデータベースを「検索・復習できる形」に変換する。

**使い方は2パターン：**
1. **シンプル活用**：要約とキーワードさえあれば検索できる。体系的なまとめページも対象。Notionページへの直リンクが強み。
2. **フル活用**：知識レベル（❓CQ／💡ナレッジ／📋まとめ）を設定し、クイズ・フラッシュカードで反復学習。Notion AIスキルとの組み合わせで「疑問→蓄積→確認→クイズ」のループが完成。

---

## ファイル構成

```
src/
├── app/
│   ├── page.tsx                        # メインページ（全タブ・状態管理）1246行
│   └── api/
│       ├── sync/route.ts               # Notion→Algolia同期
│       ├── debug-index/route.ts        # Algoliaインデックス診断
│       ├── verify-search-key/route.ts  # Search Key動作確認
│       └── notion/
│           ├── search/route.ts         # Notion直接検索（シンプルモード）
│           ├── pages/route.ts          # Notionページ一覧取得
│           ├── create-db/route.ts      # Medical/Reference DBテンプレート作成
│           └── check-props/route.ts    # DBプロパティ一致チェック
├── components/
│   ├── SetupWizard.tsx                 # 初回セットアップフロー（5ステップ）※オプションStep改善済み
│   ├── SyncPanel.tsx                   # 再同期UI（設定モーダル内）
│   ├── ResultCard.tsx                  # 検索結果カード
│   ├── QuizCard.tsx                    # クイズ用カード
│   ├── GenreBrowse.tsx                 # ジャンル別ブラウズ
│   ├── SearchResults.tsx               # Algolia検索結果ラッパー
│   ├── SearchBox.tsx                   # 検索入力
│   ├── SearchHistory.tsx               # 検索履歴
│   ├── NotionDbCreator.tsx             # NotionのDB新規作成UI
│   └── OnboardingScreen.tsx            # 初回オンボーディング画面
└── lib/
    ├── settings.ts                     # localStorage設定管理
    ├── algolia.ts                      # Algoliaクライアント初期化
    └── notion.ts                       # Notionクライアント初期化
```

---

## 設定データ構造（AppSettings）

```typescript
// src/lib/settings.ts
type AppSettings = {
  searchMode: 'notion' | 'algolia'
  // 個人用（必須）
  notionToken: string           // secret_xxx形式
  notionMedicalDbId: string     // 32文字の英数字
  notionReferenceDbId: string   // 任意
  // Algoliaモードのみ必須
  algoliaAppId: string
  algoliaSearchKey: string      // 検索専用キー（クライアント側で使用）
  algoliaAdminKey: string       // 管理キー（同期時のサーバー側のみ）
  algoliaIndex: string          // デフォルト: 'medical_knowledge'
  // 部署用（任意）
  teamLabel: string
  teamNotionToken: string
  teamNotionMedicalDbId: string
  // サブスク用（任意・Algoliaモードのみ）
  subscriptionSearchKey: string
  subscriptionAppId: string
  subscriptionIndex: string
  // プロパティ名マッピング（任意・既存DB対応）
  propSummary: string           // デフォルト: '要約'
  propKeywords: string          // デフォルト: 'キーワード'
  propKnowledgeLevel: string    // デフォルト: '知識レベル'
  propGenre: string             // デフォルト: 'ジャンル'
}
```

**重要**: algoliaSearchKeyはクライアント側（ブラウザ）で検索に使用。algoliaAdminKeyはサーバー側APIのみ。デバイスごとにlocalStorageへ保存されるため、スマホ・PCで別々に入力が必要。

---

## Algoliaインデックスのレコード構造

```typescript
{
  objectID: `personal_${pageId}` | `team_${pageId}`,
  source: 'medical' | 'reference',
  owner: 'personal' | 'team',
  teamLabel: string,
  title: string,
  // Medical用
  genre: string[],
  knowledgeLevel: string,
  detailGenre: string,
  tags: string,
  // Reference用
  author: string,
  journal: string,      // select型のオプション名をテキストとして読み取る
  year: string,         // date型の場合は年のみ抽出（extractYearText）
  evidenceLevel: string, // select型のオプション名をテキストとして読み取る
  // 共通
  aiSummary: string,    // 要約プロパティ（propMapで上書き可能）
  aiKeywords: string,   // キーワードプロパティ（propMapで上書き可能）
  lastEdited: string,   // ISO 8601
  createdAt: string,    // ISO 8601
  notionUrl: string,
}
```

**attributesForFaceting（sync時にsetSettings）**:
`filterOnly(owner)`, `filterOnly(teamLabel)`, `filterOnly(source)`, `filterOnly(knowledgeLevel)`, `genre`

---

## タブ構成とAlgoliaフィルタ

| タブ | フィルタ | 備考 |
|------|---------|------|
| 🔍 検索 | ownerFilter（所有者で動的） | 個人/部署/サブスク/全て |
| 🆕 新着 | ownerFilter | `sortBy` lastEdited desc |
| 📁 ジャンル | `genre:"XXX"` + ownerFilter | GenreBrowseコンポーネント |
| 📖 文献 | `source:reference` + ownerFilter | |
| 🧠 クイズ | `source:medical`（hitsPerPage=200）+ **クライアント側フィルタ** | 下記参照 |

### クイズフィルターの仕様（重要）

`src/app/page.tsx` の `QuizHits` コンポーネント内でクライアント側フィルタリング：

```typescript
const quizCandidates = hits.filter((h) => {
  const hasSummary = (h.aiSummary && h.aiSummary.trim()) || (h.summary && h.summary.trim())
  const isCQ = h.knowledgeLevel && (
    h.knowledgeLevel.includes('❓') ||
    h.knowledgeLevel.toLowerCase().includes('cq') ||
    h.knowledgeLevel.includes('クリニカルクエスチョン') ||
    h.knowledgeLevel.includes('クリニカルクエッション')
  )
  return hasSummary && !isCQ
})
```

**出題条件**: 「要約あり AND 知識レベルがCQでない」

**重要な設計決定**: クイズに出るのは `💡 ナレッジ` と `📋 まとめ` のみ（要約があれば）。
`❓ CQ` は調査中なのでクイズ除外。知識レベル未設定のページは要約があれば出題される（注意）。

---

## 知識レベルの設計（確定版：3分類）

| 値 | 意味 | クイズ | 推奨タイトル形式 |
|---|---|---|---|
| ❓ CQ（クリニカルクエスチョン） | 調査中の臨床疑問。Notion AIで暫定回答生成 | **除外** | 疑問文「〜はどうする？」 |
| 💡 ナレッジ | 確認済みの一問一答の知識 | **対象** | 疑問文「〜の投与量は？」 |
| 📋 まとめ | 体系的な解説ページ（教科書的） | **除外** | 名詞「敗血症」「ARDSの管理」 |

**ライフサイクル**:
1. 疑問発生 → ❓CQで登録 → Notion AIスキルで暫定回答生成 → AIオートフィルで要約入力
2. 文献確認・ファクトチェック → Answerを修正・確定 → 💡ナレッジに昇格 → クイズ対象になる
3. 関連CQ・ナレッジが増えたら → 📋まとめページを作成 → リレーションで紐付け

**現在のDB状態**: 共有DB（Medical Knowledge_DB）の知識レベルは5種類（エンティティ・プロトコル・ナレッジユニット・CQ・メモ）が残っている。Notion AI経由で3分類への変更が必要（後述のNotion AI向けプロンプト参照）。

---

## Notionプロパティ名のルール（変更禁止）

### Medical DB（必須5つ）
| プロパティ名 | 型 |
|-------------|-----|
| 名前 | title |
| ジャンル | multi_select |
| 知識レベル | select（推奨選択肢：❓CQ／💡ナレッジ／📋まとめ） |
| 要約 | rich_text |
| キーワード | rich_text |

### Reference DB（必須7つ）
| プロパティ名 | 型 | 備考 |
|-------------|-----|------|
| 名前 | title | |
| 著者 | rich_text | |
| ジャーナル名 | select または rich_text | selectのオプション名をテキストとして読み取る |
| 発行年 | date または rich_text | date型は年のみ抽出 |
| エビデンスレベル | select または rich_text | selectのオプション名をテキストとして読み取る |
| 要約 | rich_text | |
| キーワード | rich_text | |

**propMap機能**: 既存DBのプロパティ名が上記と異なる場合、設定画面の「🔤 プロパティ名のカスタマイズ」から対応名を指定できる。

---

## SetupWizard の構造（重要）

`src/components/SetupWizard.tsx`（約1190行）

### ステップ構成
- **mode**: パワーモード（Algolia）/シンプルモード（Notion）の選択
- **notion**: Integration Token + DB URL入力。`notionSetupMode`で「choose」→「after-template」（テンプレ複製後ガイド）/ 「existing」（DB URL入力）に分岐
- **algolia**: App ID / Search Key / Admin Key 入力（パワーモードのみ）
- **sync**: 接続テスト + 同期実行（パワーモードのみ）
- **options**: オプション設定（アコーディオン形式）

### オプションステップの構造（第2セッション改善済み）

`openSection` state（`null | 'team' | 'propmap' | 'subscription'`）で開閉管理。
初期状態は全セクション閉じ。1つだけ開ける排他制御。

```
🏥 部署用DB           ▼  ← クリックで展開
🔤 プロパティ名のカスタマイズ ▼  ← クリックで展開
⭐ サブスクリプションDB  ▼  ← クリックで展開
```

### 重要な実装メモ
- `PasswordInput` はコンポーネント内関数として定義（クロージャで `showPassword` stateを参照）
- `update()` 関数がDB ID系フィールドを自動で `extractNotionDbId()` に通す
- ドラフト保存：入力のたびに `saveDraft()` でlocalStorageに途中保存
- 既存設定プリフィル：再設定時は `getSettings()` から既存値を `form` に展開

---

## SettingsPanel の構造（page.tsx 内）

`src/app/page.tsx` Line 729-1055

設定モーダル（⚙️ボタン）の内容：
1. **メインメニュー**: ガイドリンク / ヘルプ / 設定変更 / リセット
2. **ヘルプ画面** (`showHelp=true`): エラー対処法 + DBプロパティ確認ボタン + Search Key確認 + Algoliaインデックス診断
3. **リセット確認** (`showResetConfirm=true`)

SyncPanel（再同期UI）は `SyncPanel.tsx` コンポーネントで、設定モーダルの下部に展開して表示。

---

## これまでの主要変更履歴

1. **sync/route.ts: clearObjects()追加** — 重複レコード排除のため同期前にインデックスをクリア
2. **ResultCard.tsx: 要約なし表示** — `hit.content`フォールバック削除、「要約なし」と表示
3. **QuizCard.tsx: 要約なし表示** — `displaySummary = hit.aiSummary || hit.summary || null`
4. **クイズfilterのknowledgeLevelバリエーション拡張** — 8種類のバリエーション対応
5. **スマホでデータ表示されない問題解消** — verify-search-key APIエンドポイント追加・再設定時に既存設定プリフィル
6. **SetupWizard UX改善** — 👁トグル追加・バリデーション表示・用途説明追加
7. **デバッグAPI追加** — debug-index・verify-search-key・設定画面ヘルプにUI追加
8. **セットアップ＆運用ガイド** — Notionにガイドページ作成・設定画面にリンクボタン追加
9. **クイズフィルター変更** — CQ除外 + 要約あり条件をクライアント側フィルタで実装
10. **propMap機能追加** — settings.ts・sync/route.ts・SetupWizard・SyncPanel全対応
11. **sync/route.ts: 参考文献DBのプロパティ型対応** — extractYearText()追加・select/date型対応
12. **SetupWizard オプションステップ アコーディオン化** — 部署用DB・プロパティ名・サブスクを折りたたみ形式に。初期状態は全閉。案内文「ほとんどの方はスキップしてOKです」追加
13. **📎 添付ファイルバッジ実装** — sync/route.tsに`extractHasFiles()`追加。Medical・Reference両DBのAlgoliaレコードに`hasAttachment: boolean`を追加。ResultCard.tsxで📎バッジ表示（bg-gray-100）
14. **SetupWizard `after-template` モード追加** — テンプレート複製後の最短フロー（3ステップガイド＋DBのURL入力のみ）。テンプレートURLは `https://tatsukinonaka.notion.site/MediNode-DB-Template`（**配布DB完成後に差し替え必要**）
15. **OnboardingScreen 全面刷新** — 3ページ構成を維持しつつ文言短縮・ビジュアル寄りに。welcomeページ説明文4行→1行。featuresページ5機能→4機能（📎添付PDF機能追加）。setupページを3ステップカード形式に変更
16. **クイズ：知識レベル未設定ユーザー向け案内カード追加** — `hasAnyKnowledgeLevel`で未設定検出、amber色の4ステップ使い方ガイドを表示

### 第4セッション（2026-06-09）完了作業

17. **Notionマーケットプレイスページ「MediNode 専用DB」整備** — 「🤖 Notion AIと組み合わせるともっと便利に」セクションを追加（❓CQ登録・📖参考文献追加・🗂まとめ棚卸しの3スキル紹介 + 有料note誘導）。マーケットプレイス出品済み（承認待ち中）。
18. **マーケットプレイス出品文作成** — 「簡単な説明」（280文字以内）・「詳しい説明」を作成・出品完了。
19. **SetupWizardのテンプレートURL仮差し替え** — `src/components/SetupWizard.tsx` L630を仮URL（`https://www.notion.so/MediNode-DB-37afd756737080ba8035f2cdb33af355`）に差し替え。承認後に正式マーケットプレイスURLへ再差し替えが必要。
20. **全変更ファイル一括コミット＆Vercelデプロイ** — 23ファイル変更（1634行追加・295行削除）をコミット。`git push origin main` 完了 → Vercel自動デプロイ完了。
21. **Reference DBサンプル件数を7件に更新** — Notionページ記載をユーザーが更新済み。

### 第5セッション（2026-06-10）完了作業 — Stripe課金フロー実装

22. **Stripe月額サブスク課金フロー実装（コミット `fb711b8`）** — Supabase不要、Stripe + Vercel API Routeのみで完結するシンプルな課金導線。3つのAPIエンドポイント新規作成：
    - `src/app/api/premium/checkout/route.ts` — Stripe Checkout Session作成。`success_url`に`?premium_session={CHECKOUT_SESSION_ID}`を付与
    - `src/app/api/premium/verify/route.ts` — 決済後のsession_idを受け取りsubscription statusを確認。アクティブなら`SUBSCRIPTION_ALGOLIA_*`キーを返す
    - `src/app/api/premium/webhook/route.ts` — Stripe Webhook受信・署名検証。`subscription.deleted`/`updated`/`invoice.payment_failed`を処理（Phase 1はconsole.logのみ。Phase 2でDB書き込み予定）
23. **page.tsx に決済完了処理を追加** — `?premium_session=`URLパラメータを検知し、`/api/premium/verify`でキー取得→`saveSettings()`でlocalStorageに自動保存→リロード。認証中はフルスクリーンオーバーレイ表示
24. **SubscriptionPromoPanel / SetupWizardに購入導線を追加** — 実際のStripe Checkout呼び出しボタン（`PremiumCheckoutButton`）。登録済みなら✅表示＋解除ボタン、未登録なら購入ボタン＋手動入力フォールバック
25. **stripe@22.2.0 を依存追加** — v22では`Subscription.current_period_end`と`Invoice.subscription`プロパティが削除されている点に注意（ビルドエラーの原因になった。該当行は削除済み）
26. **Stripeダッシュボード設定（テストモード/サンドボックス）** — 商品「MediNode プレミアム ¥980/月」作成。Price ID・Secret Key・Webhook Secret取得済み。Webhookエンドポイント `https://medical-search-public.vercel.app/api/premium/webhook` 登録済み
27. **Vercel環境変数を設定** — `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID`/`STRIPE_WEBHOOK_SECRET`/`NEXT_PUBLIC_APP_URL` を本番・プレビューに追加済み。再デプロイ後、`/api/premium/checkout`が本物のStripe決済URLを返すことを確認済み（動作確認OK）
28. **Vercel自動デプロイの修復** — `medical-search-public`プロジェクトがGitリポジトリ未接続だったため、今日のコミットが自動デプロイされていなかった。`drnode0/medical-search-template`の`main`ブランチを接続。空コミットpushで`git-main`URLの自動デプロイがトリガーされることを実証。**今後は`git push origin main`で自動デプロイされる**
29. **lib/algolia.ts のサブスク設定をハードコードに変更** — `PREMIUM_INDEX_NAME = 'Medical Knowledge_DB（サブスク用）'` を固定。インデックス名は作者管理なのでコードに直書き（変更時はここを書き換えて再デプロイ）
30. **GenreBrowse.tsx にソース切替トグル追加** — サブスク設定ありのとき「全て/個人/プレミアム」を切り替え。ジャンルに紫ドットでプレミアム該当を表示

### 第7セッション（2026-06-11）完了作業

38. **シンプルモード動作修正（コミット `a7bc06f`）** — 以下4点を修正：
    - `search/route.ts`: `extractText` に `date` 型対応を追加（参考文献の「発行年」が `date` 型の場合に年だけ正しく抽出できていなかった）
    - `page.tsx`: `NotionBrowseTab` のジャンル一覧取得を `useState(()=>{fetch...})` の誤用から `useEffect(()=>{fetch...}, [])` に修正。これによりジャンルタブが正しくロードされるようになった
    - `page.tsx`: `useNotionSearch` の `useEffect` 依存配列に `fetch` を追加。settings変更後にタブを再訪した際も最新設定で再取得される
    - `page.tsx`: `SettingsPanel` の Notion接続設定・部署DB設定保存時に `extractNotionDbId` を適用。URLをペーストしてもIDが正しく保存される

### 第11セッション（2026-06-11）完了作業 — プレミアム訴求強化（串刺し検索の価値・価格明記）

44. **プレミアム会員の訴求コピーを強化（コミット `da7e0b6`）** — ユーザー要望：プレミアム限定コンテンツの説明を充実させ、最大の強み「自分のNotion DBと著者（現役医師）の公開医療ナレッジを、ツールを切り替えずに串刺し（横断）検索できる」点を明確に伝える。共有Notionページへのジャンプ導線も明記し、価格は表示する方針（¥980/月）に確定。
    - `page.tsx` `SubscriptionPromoPanel`（プロモパネル）：①「🔍 あなたのNotionと医師のナレッジを“串刺し検索”」の訴求ブロックを追加（ツール切替不要・自分のメモも専門医の知見も同じ検索ボックスで）。②含まれるコンテンツに「横断検索」「常に最新」「共有Notionページにジャンプ」を追記。③価格ブロック「月額 ¥980（税込）／いつでも解約できます」を追加し、CTAボタンを「⭐ 月額¥980で登録する →」に変更。
    - `page.tsx` 設定 `section === 'subscription'`（プレミアムDB設定の未登録時）：同じ串刺し検索の訴求ブロック＋「月額 ¥980（税込）・いつでも解約可能」を `PremiumCheckoutButtonInline` の上に追加。
    - 既存メッセージ「現役集中治療医が定期的に更新する医療ナレッジ＋参考文献を閲覧できます」は維持。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。
    - **今後の検討余地**：「現役医師が監修」など信頼性の社会的証明、利用シーン（臨床現場ですぐ引ける）のさらなる具体化。価格は¥980/月で表示確定。

45. **「こんな方におすすめ」職種タグを追加（コミット `d7bc923`）** — ユーザー要望：おすすめの対象者を提示。救急・集中治療に携わる全職種を対象として明示（研修医/救急医/集中治療医/看護師/薬剤師/臨床工学技士/理学療法士/作業療法士/言語聴覚士/臨床検査技師）。プロモパネル（`SubscriptionPromoPanel`）と設定のプレミアム登録画面の両方に、紫の職種タグ＋「救急・集中治療に携わるすべての職種の日々の学びと現場の意思決定をサポート」コピーを追加。
    - **数値約束は意図的に回避**：「週2つのナレッジ」等の頻度・件数の未来約束は、達成できなかった際の批判リスクがあるため不採用。「定期的に」「常に最新」の表現を維持。数を出すなら実績ベース（現在◯件収録）のみ可、という方針を確認。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。

46. **おすすめ職種に4職種追加＋チーム医療訴求を強化（コミット `9e939f5`）** — ユーザー判断：推奨4職種（医学生・管理栄養士・診療放射線技師・救急救命士）を全て追加し**全14職種**に。並びは患者フロー/チーム順（医学生→研修医→救急医→集中治療医→看護師→薬剤師→管理栄養士→臨床工学技士→診療放射線技師→臨床検査技師→理学療法士→作業療法士→言語聴覚士→救急救命士）。ユーザー好評の「チーム医療で多職種が関わる」訴求を、うるさくならない範囲で補強：「救急・集中治療は多職種が連携するチーム医療。職種の垣根を越えて、現場に関わるすべての方へ」＋「同じ患者を支えるチームみんなが同じ知識を共有できる」。プロモパネル・設定の両方に反映。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。

### 第10セッション（2026-06-11）完了作業 — 文献タブ絞り込み検索＋件数表示でモード同等化

42. **パワー/シンプル両モードの機能差分を全タブ実コードで調査** — 検索/新着/クイズ/文献/ジャンルの各タブを実コードで突き合わせ。判明した実差分は2点のみ（下記43で対応）。その他はパリティ確認済み。**重要な訂正**：`SearchResults.tsx`（GenreFilter/LevelFilter/処理時間表示を持つ）は import されているがJSXで未使用。パワーモード検索タブの実体は `MergedSearchResults`（page.tsx:751）で、フィルタも処理時間表示も**両モードとも存在しない**。`SyncPanel`（page.tsx:2466）がパワーモードのみなのは Notion→Algolia 同期用で**意図的**（シンプルモードはNotion直読みのため不要）。

43. **文献タブの絞り込み検索＋件数表示を追加（コミット `3d96d1c`）** — パワーモード `ReferenceTab`（page.tsx:397）には文献内検索の `<SearchBox />` があるがシンプルモード `NotionReferenceTab` には無かった差を解消。
    - `page.tsx` `NotionReferenceTab`: 絞り込み入力 `query` state を追加。取得済みレコードに対しクライアント側で `title`/`author`/`journal`/`aiKeywords` を部分一致フィルタ（`useMemo`）。stickyヘッダを検索ボックス＋並び替えセレクトの横並びに変更（パワーモードと同レイアウト）。空状態は query有無で「該当なし」/「データなし」を出し分け。`{sorted.length}件` 表示を追加。
    - `page.tsx` `NotionSearchTab`: 検索結果に `{merged.length}件`（query時のみ）を追加し、パワーモード `MergedSearchResults` の件数表示（page.tsx:793）と同等化。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。

### 第9セッション（2026-06-11）完了作業 — シンプルモードのジャンル別タブをパワーモード同等化＋折りたたみ統一

40. **シンプルモードのジャンル別タブ（`NotionBrowseTab`）をパワーモードの `GenreBrowse` と同等に（コミット `82c1375`）** — ユーザー要望「ジャンルの箇所がパワーモードと違うので全て揃える」に対応。差分5点を解消：①番号プレフィックス（`01.`等）を `displayGenreName` で除去して表示、②`hybridSort`（番号付き→あいうえお順→INBOX最後）で並び替え、③各ジャンルに件数バッジ、④プレミアムにも存在するジャンルに紫ドット、⑤プレミアムタブで実際の作者Algoliaジャンル内容を表示（従来の案内のみから変更）。
    - `page.tsx`: `hybridSort`・`displayGenreName` ヘルパーを追加（GenreBrowse.tsx と同一実装・別ファイルのためコピー）。未使用の `NOTION_GENRE_GROUPS`・`GENRE_BUTTON_COLORS` を削除。
    - `page.tsx` `NotionBrowseTab` を全面書き換え。`type GenreFacet = { personal/team/subscription: Record<string,number> }`。全medicalレコード（mode=browse, genre=''）をNotionから取得してジャンル件数を個人/部署別に集計。サブスクは作者Algoliaのファセット（`search('', { facets:['genre'], hitsPerPage:0 })`）。`handleGenreSelect` はNotion（個人/部署）＋Algolia（サブスク）を `Promise.all` で並列取得。
    - レコードのジャンル抽出は `genreList`／`Array.isArray(genre)`／`genre` の順に分岐（`rec.genre` が `string | string[]` のため）。

41. **ジャンル折りたたみ閾値を12に統一し、パワーモードにも折りたたみを追加（コミット `b1866e7`）** — ユーザー判断「残す＋閾値12に上げる」「パワーモードにも折りたたみを追加」に対応。
    - `page.tsx`: `GENRE_SHOW_LIMIT` を 8→12 に変更。
    - `GenreBrowse.tsx`（パワーモード）: 従来は折りたたみ無し（全ジャンル常時表示）だったため、シンプルモードと同じ折りたたみ機構を追加。`GENRE_SHOW_LIMIT = 12` 定数、`GenreList` に `showAll` state、`visibleGenres = showAll ? sortedGenres : sortedGenres.slice(0, 12)`、トグルボタン（`▼ すべて表示（残り N 件）` / `▲ 折りたたむ`）。グリッドとボタンを Fragment でラップ。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。

### 第8セッション（2026-06-11）完了作業 — シンプルモードに所有者フィルタタブ追加

39. **シンプルモードに所有者フィルタタブ（全て/個人/部署/⭐プレミアム）を追加（コミット `af6af9a`）** — パワーモードと同様の所有者切替UIをシンプルモード（Notion直接検索）の全タブに展開。Algoliaを介さず個人/部署はNotion API由来、プレミアムのみパワーモードと同じ `SubscriptionSearchProvider` 機構を流用（作者のAlgoliaサブスクDB）。
    - `api/notion/search/route.ts`: `NotionRecord.owner` を `'personal' | 'team'` に変更。`queryDb` に `owner` 引数追加（`objectID` は `${owner}_${page.id}`）。クイズ用 `fetchQuizRecords(notion, dbId, owner)`・ジャンル別 `fetchBrowseRecords(notion, dbId, genre, pageSize, owner, cursor)` をヘルパー化。POST body に `teamNotionToken`/`teamNotionMedicalDbId`/`teamNotionReferenceDbId` を追加し、`hasTeam` 時は `teamNotion` クライアントを生成。recent/search/quiz/browse の各モードで個人＋部署DBを問い合わせてマージ。
    - `page.tsx` `useNotionSearch`: fetch body に team 設定3項目を追加。useCallback 依存配列に team 設定を追加。
    - `page.tsx` 各Notionタブ（NotionSearchTab/NotionRecentTab/NotionQuizTab/NotionBrowseTab/NotionReferenceTab）に `{hasTeam, hasSubscription}` props を追加。既存の `OwnerFilterTabs`・`mergeHitsByOwnerFilter`・`SubscriptionPromoPanel`・`useSubscriptionHits` を再利用。`ownerFilter` 選択が personal/team のときはサブスクヒットを `owner:__none__` で無効化、subscription のときはタブ毎の source（quiz→`source:medical`、reference→`source:reference`）で絞る。browse タブはジャンル×サブスクの二重フィルタが複雑なため、プレミアム選択時は `SubscriptionPromoPanel`/案内表示の最小対応。
    - `page.tsx` シンプルモードのルーティングを `<SubscriptionSearchProvider enableBridge={true}>` でラップ（個人hitsはNotion由来のため個人用 `<InstantSearch>` は不要）。
    - 検証: `npx tsc --noEmit` クリーン、`npm run build` 16/16ページ成功。

### 第6セッション（2026-06-11）完了作業

31. **同期APIの詳細内訳追加** — `sync/route.ts` に per-source カウンター（personalMedical/personalReference/teamMedical/teamReference）を追加。部署用DB同期エラーは個別 try/catch で warnings[] に格納し部分成功扱いに。
32. **SyncPanel.tsx の表示改善** — 同期結果に詳細内訳を表示。warnings があれば amber 色の警告ボックス表示。
33. **SettingsPanel 全面刷新（page.tsx）** — Section型でセクション別直接編集UI（`null | 'notion' | 'team' | 'subscription' | 'help' | 'redo-confirm' | 'reset-confirm' | 'mode-confirm' | 'db-setup-confirm'`）に変更。接続設定メニューに「🔀 モードを変更する」「📋 NotionDBをセットアップする」を追加。propMap設定を UI から削除。
34. **SetupWizard オプションステップから propmap 削除** — プロパティ名カスタマイズ機能は機能として非採用。オプションステップの `openSection` state は `null | 'team' | 'subscription'` のみに。
35. **SetupWizard ステップインジケーター修正** — 5ステップ（パワーモード）でモバイル幅に収まらない問題を修正。円を上・ラベルを下（flex-col）に変更。w-7 h-7 / text-[10px] / connector w-6 に縮小。
36. **SetupWizard Notionコネクト手順をNotionの現UIに合わせて修正** — フィールド順（コネクト名→認証方法→インストール可能なワークスペース）。「認証方法」選択肢を正確に **「アクセストークン」** に修正（旧「ユーザー機能なし」は誤りだった）。「OAuth」セクション表記を削除してすっきりさせた。
37. **Notion運用ガイドページ更新** — `378fd756737081a2bc23f1acb5f3a4bc` を現在の機能に合わせて全面書き換え。モード選択・iOS PWA注意・新SettingsPanel対応・変更ログ追加。

---

## 未完了タスク（次セッションで対応が必要）

### 🔴 優先度高

#### 0. Stripe本番化 + 決済フロー実機テスト（第5セッションの続き）

Stripe課金フローの**実装・デプロイ・環境変数設定は完了済み**。残りは本番化と動作確認のみ：

1. **テストカードで一連の決済フローを確認**
   - アプリURL（https://medical-search-public.vercel.app）の購入ボタン → Stripe Checkout
   - テストカード `4242 4242 4242 4242`（有効期限・CVCは任意の未来日付・3桁）で決済
   - 決済後 `?premium_session=...` で戻り、`/api/premium/verify` がAlgoliaキーをlocalStorageに保存 → プレミアム検索が使えることを確認
2. **サブスク用Algolia DBにデータ投入**
   - `SUBSCRIPTION_ALGOLIA_APP_ID` / `SUBSCRIPTION_ALGOLIA_SEARCH_KEY` がVercelに設定済みか確認（`vercel env ls`）
   - サブスク用Notion DB → `subscription_medical` インデックスへ `/api/subscription/sync` で同期（`SUBSCRIPTION_SYNC_SECRET` 必須）
   - インデックス名は `lib/algolia.ts` の `PREMIUM_INDEX_NAME = 'Medical Knowledge_DB（サブスク用）'` と一致させる
3. **テストモード → ライブモードへ切替（実課金開始時のみ）**
   - StripeダッシュボードでライブモードのProduct/Price作成 → `STRIPE_SECRET_KEY` を `sk_live_...` に、`STRIPE_PRICE_ID` をライブのPrice IDに差し替え
   - Webhookエンドポイントもライブモードで再登録 → `STRIPE_WEBHOOK_SECRET` 更新
   - **注意**: ライブ化は実際に課金が走るので、note公開・集客の準備が整ってから

**第5セッションで確認済みの認証情報（テストモード）**:
- Price ID: `price_1TgmnCDZKrpUF6DafLwWHYr5`
- Webhookエンドポイント: `https://medical-search-public.vercel.app/api/premium/webhook`
- Vercel環境変数: `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_APP_URL` 設定済み

#### 1. SetupWizardのテンプレートURL再差し替え（マーケットプレイス承認後）

`src/components/SetupWizard.tsx` L630:
```
window.open('https://www.notion.so/MediNode-DB-37afd756737080ba8035f2cdb33af355', '_blank')
```
↑ **仮URL。マーケットプレイス承認後に正式テンプレートURLに差し替えてコミット＆デプロイ。**

#### 2. 有料note執筆（次セッションのメインタスク）

**note記事の想定構成（確定していない部分はセッション開始時に確認）：**

| # | セクション | 内容 |
|---|-----------|------|
| 1 | はじめに | MediNodeとは・誰向けか・何が解決できるか |
| 2 | アプリURLと初期設定 | アプリURL・セットアップ手順（Notion Integration作成〜同期まで） |
| 3 | DBテンプレートの使い方 | Medical Knowledge_DB・Reference Library_DBの各プロパティの意味と使い方 |
| 4 | 知識の蓄積ワークフロー | 実際の使い方（CQ登録→ナレッジ化→まとめ）の例 |
| 5 | Notion AI活用法（目玉） | CQ登録・参考文献追加・まとめ棚卸しのAIスキル設定・使い方 |
| 6 | 上級者向け設定 | パワーモード（Algolia）・チームDB・propMapカスタマイズ |
| 7 | おわりに | サブスク予告・フィードバック案内 |

**参照すべきNotionページ：**
- AIスキル定義：`https://app.notion.com/p/DB-978141ced8c9469ca44666849837c468`
- セットアップ＆運用ガイド（既存）：`https://app.notion.com/p/378fd756737081a2bc23f1acb5f3a4bc`
- マーケットプレイスページ（配布DB）：`https://app.notion.com/p/MediNode-DB-37afd756737080ba8035f2cdb33af355`

**note執筆セッションの開始プロンプト例：**
```
MediNodeという医療知識管理アプリの有料note記事を書きます。
HANDOFF.mdを読んで背景を把握した上で、note本文のドラフトをMarkdown形式で作成してください。
アプリURL: https://medical-search-public.vercel.app
価格帯: ¥1,980想定
```

#### 3. 配布DB（Notion）のサンプルデータ充実（Notion側作業）

Medical Knowledge_DBのサンプルを増量する（現在の件数から20〜30件程度まで）。
- 知識レベル3種（❓CQ / 💡ナレッジ / 📋まとめ）を満遍なく入れる
- 要約・キーワード・ジャンルなど主要プロパティを埋める
- Reference DBは7件入力済み

### 🟡 優先度中

#### 4. クイズの設計上の問題（案内カードで対処済み・要様子見）

知識レベルを設定していないユーザーは「要約ありのページ全て」がクイズ対象になる問題。
第3セッションで知識レベル未設定ユーザー向けの案内カード（amber色・4ステップ）を追加済み。
ユーザー反応を見て、さらに制限するかどうか判断。

#### 5. Notion側のDB変更（Notion AI経由で対応）

共有DB（Medical Knowledge_DB）の知識レベル選択肢を5種→3種に変更が必要。
下記のNotion AI向けプロンプトを使って対応する。

### 🟢 将来（サブスク実装時）

#### 6. サブスクDB：職種別フィルタリング

**背景**: 医師・看護師・理学療法士などは関心ジャンルが異なる。
**設計案（ハイブリッド型）**:
- NotionのサブスクDBに `targetRole`（対象職種）プロパティを追加（multi_select）
- `filterOnly(targetRole)` をfacetingに追加（sync/route.tsで対応可能）
- サブスク登録時に職種 + 関心ジャンルを選択 → Algoliaクエリに自動付与
- `filters: 'owner:subscription AND (targetRole:看護師 OR targetRole:全職種)'`
- ユーザーが後から自由にカスタマイズも可能

**実装コスト**: 低〜中。sync/route.ts に数行 + SetupWizard/page.tsx に職種選択UI追加。
**優先度**: 初期ユーザー獲得後に判断。まず有料note・配布DBで反応を見る。

---

## Notion AI向けプロンプト（DB変更用）

Medical Knowledge_DBを開いた状態でNotion AIに以下を渡す。

```
# MediNode 設計変更 – Medical Knowledge_DB の更新依頼

## 1. 知識レベルの選択肢を3分類に変更する

変更後の選択肢（これのみにする）：
- ❓ CQ（クリニカルクエスチョン）：調査中の臨床疑問。クイズ除外。
- 💡 ナレッジ：確認済みの一問一答の知識。クイズ対象（要約があれば）。
- 📋 まとめ：体系的な解説ページ。クイズ除外。

既存データへの対応：
- 📋 エンティティ → 📋 まとめ
- 🚦 プロトコル → 📋 まとめ
- 💡 ナレッジユニット → 💡 ナレッジ
- ❓ クリニカルクエスチョン → ❓ CQ
- 📎 メモ → 削除（INBOXや別ページで管理）

## 2. ページテンプレートを3種類に整理する

### ❓ CQ テンプレート
## ❓ Question
（臨床疑問をここに書く）

## 💡 Answer（結論／回答）
（Notion AIスキルで暫定回答を生成。確認が取れたら修正し、知識レベルをナレッジに変更する）

## 📚 Evidence／文献
（根拠にした文献・参考ページ）

## 💭 背景・きっかけ
（なぜこの疑問が生まれたか）

---
### 💡 ナレッジ テンプレート
## 💡 Answer（結論／回答）
（確認済みの結論を書く）

## 📚 Evidence／文献
（根拠にした文献・参考ページ）

## 💭 補足・注意事項
（施設差・例外・関連知識など）

---
### 📋 まとめ テンプレート
## 概要
（このまとめの対象・範囲）

## 内容
（体系的な解説をここに書く）

## 関連CQ・ナレッジ
（このまとめから派生したCQ・ナレッジへのリレーション）

## 参考文献
（参照した文献）

## 3. 要約プロパティのAIオートフィル設定を更新する

CQ・ナレッジ用：
---
このページ本文を読み、臨床的な「結論（要点）」だけを日本語で要約してください。
【対象】「Answer（結論／回答）」セクションの要点のみを使う。
【含めない】「Evidence／文献」「背景・きっかけ」「補足・注意事項」は入れない。
【出力ルール】100〜150字のプレーンテキスト、1〜2文。装飾なし・数値優先・確信度保持・前置き禁止。
CQの段階でAnswerが空欄の場合は暫定要約を生成してよい。
---

まとめ用：
---
このページ本文を読み、「何についての、どんなまとめか」を日本語で要約してください。
【対象】「概要」「内容」セクションの要点を使う。
【出力ルール】100〜150字のプレーンテキスト。冒頭で対象（疾患名・テーマ）が分かるようにする。装飾なし・前置き禁止。
---

## 4. キーワードプロパティのAIオートフィル設定を更新する

CQ・ナレッジ・まとめ 共通：
---
このページのタイトル・本文（Question / Answer / Evidence / 概要 / 内容 等）・「要約」プロパティを読み、検索用の医学キーワードを抽出する。
出力は「カンマ＋半角スペース」区切りの1行のみ。5〜15語。
疾患／薬剤／検査／手技／ガイドライン名を優先し、「治療」「患者」等の一般語は除外する。
日本語と英語／略語は1語ずつ別々に入れる（例：敗血症, sepsis, ARDS）。
本文に根拠のある語だけを入れ、推測語は入れない。
---
```

---

## デプロイ方法

```bash
cd /Users/tatsukinonaka/medical-search-public
git add src/...（変更ファイル）
git commit -m "fix/feat: 説明"
git push origin main
# → Vercel が main ブランチを自動デプロイ（手動デプロイ不要）
```

型チェック:
```bash
cd /Users/tatsukinonaka/medical-search-public
npx tsc --noEmit
```

ローカル開発:
```bash
cd /Users/tatsukinonaka/medical-search-public
npm run dev
# → http://localhost:3000
```

---

## ビジネスモデル（確定方針）

| フェーズ | 内容 |
|---------|------|
| 無料公開 | Notionマーケットプレイスに配布DB（Medical Knowledge_DB + Reference Library_DB）をテンプレート公開。サンプルデータ入り。 |
| 有料note | アプリURL・セットアップ詳細・知識蓄積スキル・Notion AI活用法・使い込んだDBの作り方をまとめて販売。目安¥1,980。 |
| 将来（サブスク） | 著者が定期更新するDBへのアクセス権 + ユーザーの臨床疑問を回数制限付きで蓄積するサービス。職種別フィルタリング実装が前提。 |

**方針のポイント**:
- アプリ自体のURL・機能は有料note経由で公開（完成度を下げずに囲い込み）
- 配布DBは無料でマーケットプレイス公開（拡散効果 + ダウンロード数で反応確認）
- 有料noteにアプリURL・DBのセットアップ詳細・スキルを全部入れる

---

## 次セッションで作業する場合の注意

1. `src/app/page.tsx` はメインファイルで1246行。設定モーダル（SettingsPanel: L723-1055）・各タブ・Algoliaクライアント初期化が全て入っている
2. SetupWizard内の `PasswordInput` はコンポーネント内関数として定義（クロージャで `showPassword` stateを参照）
3. Algoliaモードの検索はすべてクライアント側（react-instantsearch）、NotionモードはAPIルート経由
4. スマホ問題の根本：localStorageはデバイスごとなのでスマホで別途キー入力が必要
5. クイズのフィルターはAlgoliaフィルタ（`source:medical`）＋クライアント側フィルタの2段階構成
6. propMapは同期時にサーバー側（sync/route.ts）に渡され、Notionプロパティ名の解決に使う
7. 共有DBのMedical Knowledge_DBはまだ5分類のまま。Notion AI経由で3分類への変更が必要
8. SetupWizardのオプションステップはアコーディオン形式に変更済み（`openSection` stateで管理）
9. SetupWizardの `notionSetupMode` は `'choose' | 'after-template' | 'existing'` の3種。`after-template` はテンプレ複製後の3ステップガイド付きURL入力フロー
10. OnboardingScreenのテンプレートURLも同じプレースホルダー（SetupWizardと同じURLに揃える）
11. Algoliaレコードに `hasAttachment: boolean` が追加済み（第3セッション）。再同期すれば既存DBにも反映される

---

## 関連Notionページ

| ページ | URL |
|--------|-----|
| MediNode アプリ開発 | https://app.notion.com/p/feb1afd11fdc42fc9fba7f5df6f1ad64 |
| 共有DB（Medical Knowledge_DB / Reference Library_DB） | https://app.notion.com/p/978141ced8c9469ca44666849837c468 |
| セットアップ＆運用ガイド | https://app.notion.com/p/378fd756737081a2bc23f1acb5f3a4bc |
| 引き継ぎ帳（Notion版） | https://app.notion.com/p/378fd7567370815885e8d67e6835e2c6 |
