# MediNode 開発引き継ぎ帳

**最終更新**: 2026-06-09（第3セッション）
**プロジェクトパス**: `/Users/tatsukinonaka/medical-search-public`
**デプロイ先**: https://medical-search-public.vercel.app
**Vercelプロジェクト**: `tnonaka1101-stacks-projects/medical-search-public`

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

---

## 未完了タスク（次セッションで対応が必要）

### 🔴 優先度高（配布・リリースに必要）

#### 1. 配布DB（Notion）にサンプルデータ20〜50件入力（Notion側作業）

Medical Knowledge_DB と Reference Library_DB に、アプリのUIが映えるサンプルデータを入力する。
- 知識レベル3種（❓CQ / 💡ナレッジ / 📋まとめ）を満遍なく入れる
- 要約・キーワード・ジャンルなど主要プロパティを埋める
- 参考文献DBには著者・ジャーナル・発行年・エビデンスレベルも入れる

#### 2. SetupWizardのテンプレートURL差し替え

`src/components/SetupWizard.tsx` L630:
```
window.open('https://tatsukinonaka.notion.site/MediNode-DB-Template', '_blank')
```
↑ **プレースホルダー。配布DB完成後に実際のNotionテンプレートURLに差し替える。**

#### 3. Notionマーケットプレイスへの提出・有料note執筆

配布DB完成後に対応。

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
npx vercel deploy --prod
```

型チェック:
```bash
npx tsc --noEmit
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
