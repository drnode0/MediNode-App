# スプレッドの進捗を「あと何が残っているか」で見せる（管理タブ）設計

日付: 2026-09-07　状態: オーナー承認済み（設計セッション: BaseMap/MediNode-コンテンツ）
実装: 別セッション（Opus 5）。この設計書を読んで `superpowers:writing-plans` から始める。

## 目的

`/admin` のスプレッドタブと Essentials タブが「この記事は、読者に届くまであと何が残っているか」に答えるようにする。
今は、スプレッドを投入して初めて一覧に載り、Essentials タブの段階6「サブスク移行済」に「読者に出ている」と書いてあるが、
実際にはスプレッド公開→制作ステータス 7️⃣ まで読者に出ない。工程の存在しない段階があるため、完了に見えて届いていない本が生まれる。

背景の工程（コンテンツ側・コードの外）は `~/.claude/skills/medinode-essentials/SKILL.md`「スプレッドまで通す」の8手順。
このタブが見せるのは、そのうちアプリのデータから判定できる部分。

## 変更1: スプレッドタブ（`src/app/admin/SpreadCard.tsx`・`/api/admin/spread`）

### 一覧の対象

- `reader_spreads` の全行（今のまま）
- **加えて、サブスクDBにあってスプレッド行が無い記事**を「未投入」として出す。
  対象は 📚（タイトルが「📚」で始まる、または `splitSections` で型1/型2の節構造を持つ）と、
  💡のうち制作ステータスが `3️⃣` 以上のもの。同期が読むサブスクDBの一覧を使う（新しい取得経路は作らない）。
  ※ 対象の絞り方は実装時に `subscription-publish-gate.ts` と同じ判定を使い、ここで新しい分類語を作らない。

### 1記事1行・6点のストリップ

| 点 | 判定（すべて既存データ） |
|---|---|
| 棚にある | 原本がサブスクDBにある（今の `offShelf` の逆） |
| 計画あり | スプレッドノート_DB にその page_id の行がある（`findSpreadNotesPageId`） |
| 投入済 | `reader_spreads` に行があり、`overlay` が `{}` でない |
| 設問承認 | `spread_doc.quizzes` が1問以上あり、全問 `reviewed: true` |
| 公開 | `status === 'published'` |
| 読者に出る | 制作ステータスが同期の門を通る（`isWithheldFromReaders` の逆） |

既存の `stale`（原本が更新されています）はそのまま出す。

### 「次の一手」1文

6点と stale から、記事ごとに1文を出す。例：
- 「スプレッド未投入。見せ方の相談から」
- 「設問2問が未承認」
- 「公開済みだが制作ステータス 3️⃣ のため読者に出ていない。7️⃣ に上げる」
- 「原本が更新されている。再生成してから承認」
- 「完了」

### 並び

未完了を上、完了（6点すべて）を下に畳む。同名の別 page_id は両方出す（「棚にある」で見分けがつく）。

## 変更2: Essentials タブ（`src/app/admin/EssentialsCard.tsx`・`src/lib/essentials-admin.ts`）

- 制作DBの段階の選択肢に **「7 スプレッド公開」を追加**する（Notion 側・改名はしない。改名は選択肢の削除＋新規作成になりタグが外れる既知の事故がある）。
  `ESSENTIALS_STAGES` と `STAGE_STYLE` に7段目を足す（青の濃淡は配色検証を通した値に揃える）。
- 段階6の注記「読者に出ている」を **「スプレッド待ち」** に直し、「読者に出ている」は段階7の注記にする。
- 段階6のまま `reader_spreads` が published で制作ステータスが門を通る本には「段階を7に上げる」の促しを行に出す。

## 判定は純関数に集める

`src/lib/spread-progress.ts`（新規）に

```ts
type SpreadProgressInput = { onShelf: boolean; hasPlan: boolean; overlayEmpty: boolean; quizzes: {reviewed: boolean}[]; status: string; withheld: boolean; stale: boolean }
type SpreadProgress = { steps: { key: string; done: boolean }[]; next: string; complete: boolean }
export function spreadProgress(input: SpreadProgressInput): SpreadProgress
```

を置き、テスト（`src/lib/__tests__/spread-progress.test.ts`）で6点と「次の一手」の対応を全パターン固定する。
画面はこの関数の結果を描くだけにする。工程が変わっても直す場所を1つにするため。

## やらないこと

- 見せ方の相談（部品計画）の承認UI。チャットで済む
- 新しい部品
- コンテンツ側の工程（本文凍結・画像・命名）の状態表示。アプリのデータに無いため、「計画あり」の1点で代表させる

## 検証

- テストが通る
- `/admin` を実データで撮る。2026-09-07 時点の6行（公開4・下書き2）がストリップと「次の一手」つきで出ること。
  特に、💡PCT（下書き・設問2問未承認）が「設問2問が未承認」、📚急性呼吸不全（公開・3️⃣か7️⃣かは実データを見る）の「読者に出る」の点が実態と一致すること
- 管理者セッションが要るので、画面の目視はオーナーが行う。Claude は dev サーバで描画まで確かめる

## 未確認（実装時に現物で確かめる）

- サブスクDBの記事一覧を admin から引く既存経路があるか（同期処理の取得関数を再利用できるか）
- スプレッドノート_DB の行の有無を一覧の件数ぶん問い合わせると遅くならないか（`?check=1` と同じく開いたときだけ叩く）
