# Recall 引き継ぎ（2026-09-11 時点）

別のコーディングエージェント（codex 等）に Recall の作業を渡すための1枚。
**この紙は要約で、正は各設計書と実装。** 迷ったら「§8 一次資料」の順で当たる。
恒久的な記録は Notion 🎬プロジェクト_DB 側を正とする（このリポジトリの Markdown は引き継ぎ用の一時ファイル）。

基準コミット: `aded8fe`（main・2026-09-10）

---

## 1. Recall とは何か（概念）

MediNode の検証済みコーパス（サブスク医学DBの公開ページ）を **「主張」** の粒に割り、
読んだあとに手元へ残して間隔反復で確かめる画面。**内の輪（読む → 残す → 確かめる → 定着）** を1画面に載せたもの。

外の輪（疑問 → 段0で棚を引く → AI が組む → 作者が検証 → 正本化）と合わせて「双輪サイクル」と呼ぶ。
Recall は内の輪の実装で、外の輪は `ask_shelf`（聞ける棚）という別機能として並行して走っている。

### 用語（画面に出す語）

| 語 | 意味 |
|---|---|
| **主張** | 検証済みコーパスの主張1つ。原文1文＋出典。粒の単位。ページでも節でもない |
| **残す** | その主張を自分の出題母集団に入れる操作 |
| **読んだ** | 記事の節を読了したとき、その節の主張が自動で受ける状態。出題対象ではない |
| **確かめる** | 忘れかけの主張をカードにして答える操作 |
| **深く残した** | 復習間隔が90日以上になった主張の表示名（内部名は `settled`。**画面に「定着」とは書かない**） |
| **離れかけ** | 保持力が 0.28 を割った主張。次の「確かめる」の対象。金色で出す |
| **分野 / 記事 / 節** | 席（ジャンル）／Notion ページ／見出し区切り。「席」は内部語で画面に出さない |

**使わない語（UI・コード・コミットメッセージすべて）**: 振る・拾う・血肉・落ちる・定着・惑星・輪（宇宙の文脈では「星団」）・長いダッシュ。

### 状態の5段（これが Recall の中核）

中心に近い／濃いほど自分のもの、という1軸で全部を読む。

| 状態 | 判定 | 点の見え方 |
|---|---|---|
| 未着手 `cold` | 記録なし・節も未読 | 輪郭だけ・不透明度 0.35 |
| 読んだ `touched` | 節の読了あり・残していない | 輪郭だけ・0.55 |
| 残した `kept` | 記録あり・保持力 ≥ 0.28 | 塗り・`0.5 + 0.45 × 保持力` |
| 深く残した `settled` | 間隔90日以上 | 塗り・1.0・外側に細い後光 |
| 離れかけ `escaping` | kept/settled で保持力 < 0.28 | 金の塗り・淡い滲み |

- **保持力** `remainingOf` = `1 − 経過日数 / 間隔日数`（0〜1。1が満タン）。時間で必ず減る
- **離脱候補** `pickCandidates` = 保持力 < `ESCAPE_THRESHOLD 0.28` を低い順に最大 `MAX_CANDIDATES 5`
- **SRS の段** `applyResult` = 覚えた 1→3→7→14→30→60→120→240→365日で頭打ち。まだ で1日へ巻き戻し。**卒業させない**

### 守っている設計上の約束

- 粒＝主張1つ。カードは1主張1枚。選択肢は出さない。AI の解説は付けない
- **伏せ字は原文の数値だけを隠す。AI の創作文は出さない。** 数値の無い主張は全文伏せの「想起カード」
- 承認していない主張も球・一覧・出題に出る（伏せ字にならないだけ）
- 見た目は線画。面・塗り・影を使わない（例外は空席のガスだけ）。光（金）は離れかけにだけ
- 判断は `src/lib/recall/` の純関数に置き、部品（`src/components/recall/`）はモデルを写すだけ。
  テストは DOM を持たない（`vitest.config.ts` に environment 無し）。canvas は偽 ctx で描画の判断を記録する
- **オーナー専用**。`hasFeature('recall')` が偽の利用者には画面・タブ・API のどこにも存在を見せない
  （API は 7 メソッドすべてを 404 で塞ぐ。`src/lib/recall/guard.ts`）

---

## 2. いま本番で動いているもの（2026-09-11）

Recall タブを開くと **標本帳（図鑑）** が出る。惑星（環状に並ぶ球）と単一の球は主動線から退役済み（コードは隠しコマンドに残る）。

```
Recall タブ
└ 一覧（RecallDex）… 見出し・「Recall とは」の折りたたみ・今日の帯・分野ごとの一枚（plate）
   ├ 「離れかけを順に確かめる」… 離れかけのある分野を席番号順に回る
   └ 一枚をタップ → 分野ページ（RecallPlatePage）
        ├ 記事の目次（貼り付くチップ）／記事の帯／節の見出し／主張1つ＝点1つの列
        ├ 点をタップ → 本文1行 → もう一度で カード（離れかけ=quiz・他=view）
        ├ 「この分野を確かめる（n）」… 最大5枚を順に出す（RecallCard・dex-quiz.ts）
        └ 紋章（96px）をタップ → 隠しコマンド（RecallLift）
             球（その分野だけ・縦横斜め自由回転）
               ↕「さらに宇宙へ」／「戻る」
             宇宙（7族の星団・遠景）→ 惑星を押すと中央へ寄る（中景）→ もう一度押すと球
```

添付スクリーンショットの4枚がそれぞれ 宇宙（遠景）／球（呼吸）／分野ページ／一覧 に当たる。

### データの規模（本番・2026-09-07 実測）

- `recall_claims` 725件（全部 `cloze_status='pending'`。**承認は0件**）
  - 数値の穴が検出済み（承認待ち）378 ／ 穴なし・数字なし 213 ／ 穴なし・研究統計として除外 134
- 27記事・15分野が使用中。席は38定義（29.学会は廃番）で、残り22席前後は空席＝宇宙ではガス
- 主張の長さは中央値 約82字・9割が149字以内

### 実装済みの機能（完了した設計・計画）

| 段 | 中身 | 設計書 |
|---|---|---|
| 定着エンジン | 主張の抽出・同期・テーブル・SRS・配置・カード・管理画面の篩 | `2026-09-02-recall-engine-design.md` |
| 七つの族の芯 | 7族＝7つの動き。紋章の形と動きの定数 | `2026-09-03-seven-cores-design.md` |
| 惑星の中の体験 | 居場所5段・分野ごとの確かめる・3段の寄り方・記事の扇形（段1〜5 完了） | `2026-09-04-recall-planet-ux-design.md` |
| 標本帳 | 玄関を惑星から図鑑へ。点の濃さで5段を読む。惑星は隠しコマンドへ | `2026-09-04-recall-dex-design.md` |
| ブラッシュアップ7件 | 実機調査の手当て（紋章の位置・金の色・信号の芯 ほか） | 計画 `2026-09-05-recall-brushup-plan.md` |
| 再計画（分野ページ・説明・隠しコマンドの段） | 分野ページを点の地図へ／「Recall とは」／球→宇宙→中景→球 | `2026-09-05-recall-replan-design.md` |

読む画面からの入口も実装済み（`RecallNode.tsx`・`SectionReadButton.tsx`・`SectionReadMark.tsx`・`RecallProvider.tsx` の楽観反映）。

---

## 3. コードの地図

### 純関数（`src/lib/recall/`）— 判断はすべてここ

| ファイル | 役割 |
|---|---|
| `types.ts` | `RecallClaim` / `RecallProgress` / `RecallState` など型の定義 |
| `srs.ts` | 間隔反復・保持力・離脱候補・次の期限（`applyResult` `remainingOf` `pickCandidates` `nextDue`） |
| `notice.ts` | 「いま確かめる主張はありません。次は○日後に○件」の文言 |
| `extract-claims.ts` | Notion 本文 → 主張（確信度マーク形式と Essentials 形式。❓は除外） |
| `sync-claims.ts` | `recall_claims` への upsert と非活性化。**承認済みの `holes` と `cloze_status` は触らない** |
| `holes.ts` / `segments.ts` | 伏せ字の穴の自動検出（研究統計を除外する NOISE 規則群）と表の切り分け |
| `genres.ts` / `genre-en.ts` / `cores.ts` / `families.ts` | 席（38）・英名・7族の割り当て・族の表 |
| `dex.ts` / `dex-quiz.ts` | 標本帳のモデル（一枚・分野ページ・今日の帯）と確かめるの列 |
| `field*.ts`（`field` `field-layout` `field-angle` `field-camera` `field-cluster` `field-palette` `field-render`） | 惑星・球・宇宙の配置・カメラ・パレット・canvas 描画 |
| `core-shapes.ts` | 7族の芯の線の座標と動き |
| `lift-phase.ts` | 隠しコマンドの遷移表（球 ⇄ 宇宙 ⇄ 中景） |
| `guard.ts` | API の機能ガードと 404 で塞ぐヘルパ |
| `reader-claims.ts` / `claim-text.ts` / `optimistic.ts` / `about.ts` | 読む画面側の突き合わせ・楽観反映・説明文 |

### 部品（`src/components/recall/`）

`RecallScreen`（画面の状態とカードの出し入れ）／`RecallDex`（一覧）／`RecallPlatePage`（分野ページ）／
`RecallLift`（隠しコマンドの覆い）／`RecallField`（canvas の操作と RAF）／`RecallCard`（カード）／
`RecallDot`（点）／`CoreEmblem`＋`emblem-loop`（紋章の共有 rAF）／`RecallAbout`／
`useFieldData`・`useRecallData`（在庫）／`RecallProvider`（読む画面からの残す・読んだ）。

### API

| ルート | 中身 |
|---|---|
| `GET /api/recall/claims` | 主張の取得。`recall_claims` は **RLS 全拒否**なので `createAdminClient()`（service_role）で読み、`requireRecall()` だけが関門 |
| `GET /api/recall/progress` | 本人の記録と読了。RLS 下のユーザークライアント |
| `POST /api/recall/keep` | 残す／外す（外すは `removed_at` の論理削除） |
| `POST /api/recall/review` | 覚えた／まだ。段の進み方は `applyResult` だけが決める |
| `POST /api/recall/read` | 節の読了 |
| `GET/PATCH /api/admin/recall/cards` | 篩（承認・見送り・穴を直す）。画面は `src/app/admin/RecallCardsPanel.tsx` |

どのルートも本業以外の HTTP メソッドを 404 で塞いである（OPTIONS の 204+Allow で存在が漏れるため）。

### テーブル（`supabase/migrations/0029_recall.sql`）

`recall_claims`（コーパス・service_role のみ）／`recall_section_reads`（読んだ節）／
`recall_progress`（残した主張の記録）／`recall_review_log`（追記のみ）。
`recall_claims.revised_at` は作ってあるが**未使用**（改訂の旗 D10 用）。

### 開発用ハーネス

`/dev/recall-screen`（標本帳・仮データ）と `/dev/recall-field`（球／宇宙・配置と段の切り替え）。
見た目の確認は Python の playwright で撮る（Node 側の playwright は入っていない）。

### テスト

`src/lib/__tests__/recall-*.test.ts` が35本。`npx vitest run src/lib/__tests__/recall-*.test.ts`。
※ このセッションの環境には `node_modules` が無く、**今回は実行していない**。

---

## 4. 次にやる作業（着手待ち・優先順）

### 4.1 想起カードに穴を付ける（設計・実装計画とも完成済み。**未着手**）

設計 `2026-09-07-recall-hole-suggestion-design.md` ／ 計画 `2026-09-07-recall-hole-suggestion-plan.md`（9タスク）。

いまの問題は「確かめる」のカードの表に思い出す対象が出ていないこと。承認が0件なので伏せ字カードが1枚も存在せず、
347件は穴の候補すら無い。そこに AI（**`claude-opus-5` を既定**・実測で穴を作れた率 70% 対 Sonnet 35%）で
候補を1つ付け、`/admin` で承認したものだけ読者に出す。

要点（実装する人が外してはいけないところ）:

- migration **0033** で `recall_claims` に3列（`hole_suggestion` / `hole_suggested_at` / `hole_suggestion_note`）。
  **既存の `holes` には書かない**（毎晩の同期が pending の `holes` を上書きするため翌朝消える）
- **AI に文字位置を返させない。** 伏せる範囲の「文字列」を返させ、本文にちょうど1回現れることを検証してから位置に直す
- 検証 `verifyHoleSpan` の4条件（ちょうど1回・2〜40字・本文全体でない・既存の穴と重ならない）を1つでも外したら候補にしない。
  fail-closed。理由は「伏せ字を開いたときに原文と違う文字が出る」のが最悪の壊れ方だから
- ファイル分けは段1（`src/lib/ask-shelf/stage1-*.ts`）と同じ4分割（prompt / verify / call / route）。SDK に触るのは1ファイルだけ
- 1リクエスト20件まで。同期の後段でも最大20件。費用はアプリに持たない（単価表を持つと価格改定で黙って嘘になる）
- 承認画面は既存の `RecallCardsPanel` にタブを足す（新しい画面を作らない）
- 再検討ライン: 「向かない」が5割超 → 想起カードの作りに戻る。手直し率3割超 → プロンプトか検証を見直す

### 4.2 「振るい落とし」機構（**壁打ちの段階。実装計画は無い**）

`2026-09-03-recall-furui-brief.md`。オーナーの希望は「回す・傾ける・揺するという手の動きそのものが復習の選定になる」。
決めることが8つ並べてあり、**1番（物理が選定を決めるのか、演出だけか）が分岐点**。いまのコードは B案（`pickCandidates` が決め、物理は見せ方）。
ブリーフの末尾に「次のセッションの最初の一言」がそのまま置いてある。**コードを書く前に壁打ちする紙**。

### 4.3 積み残し

| 件 | 状態 |
|---|---|
| 改訂の旗（D10） | `revised_at` を同期側で埋めてから記事の見出しに出す。未着手 |
| 「今日の1問」の撤去 | 廃止と決定済みだが**まだ撤去していない**（`src/lib/daily-question*.ts`・`/api/daily-question`・`/api/cron/daily-push`・`vercel.json` の cron が現存）。撤去範囲の表は engine 設計書にある |
| 残した主張を利用者の Notion に落とす | 設計未着手（`/api/notion/create-db` は既にある） |
| クイズタブと Recall の統合 | v1 では判断しない |
| 描画層の WebGL 差し替え | active な主張が 2,500 を超えたら。配置・状態の層は変えない |
| 一般公開 | `RECALL_GA` は drnode.com で MediNode を出す判断まで置かない。再検討ライン 2026-12 |

---

## 5. 作業するときの決まり

- **オーナー専用のまま進める。** `feature-access.ts` の `recall`（`RECALL_EMAILS` / `RECALL_GA`）。判定はサーバーが正
- 設計 → 実装計画 → 1タスク1コミットの順。計画は `docs/superpowers/plans/`、設計は `docs/superpowers/specs/`
- 実データで検証する。自作の文字列だけのテストにしない（穴検出・配置・抽出は実コーパスを通す）
- 見た目の判断は**コードで回る現物**で行う（静止画で選ばない。ラフの URL が各設計書の冒頭にある）
- 決定を変えたら、設計書の該当行に日付つきで書き足す（このリポジトリの既存の作法。例: 惑星 設計書の決定9〜14）
- 再検討ライン（いつ戻すか）を必ず書く

### このリポジトリに書いてはいけないこと

公開リポジトリなので、**事業数値（登録者数・課金数・売上・コスト）／税務・資産・健康・家族／記憶にしかない社外秘の判断**は
ファイル・コミットメッセージ・PR・コード内コメントのどこにも書かない。公開済みの仕様と技術的事実は書いてよい。

---

## 6. 直近の履歴（Recall 関連）

| 日付 | 出来事 |
|---|---|
| 2026-09-02 | 定着エンジンの設計確定・実装開始（主張700件を実測） |
| 2026-09-03 | 七つの族の芯を作り直し。振るい落としのブリーフを書く |
| 2026-09-04 | 惑星の中の体験（段1〜5）。同日夜に玄関を標本帳へ切り替える決定 |
| 2026-09-05 | 標本帳の実装 → 実機フィードバック → 再計画（分野ページ・説明・隠しコマンドの段）を当日中に実装 |
| 2026-09-07 | 想起カードの手がかり案を実装して破棄。穴の AI 候補づくりの設計と9タスクの計画 |
| 2026-09-10 | 大型アップデートの予告を配信（機能名は伏せる） |

---

## 7. 引き継ぎ先への最初の一言（コピー用）

```
docs/superpowers/HANDOFF-recall.md を読んでから、
docs/superpowers/specs/2026-09-07-recall-hole-suggestion-design.md と
docs/superpowers/plans/2026-09-07-recall-hole-suggestion-plan.md を読んで、
Task 1（検証の純関数）から1タスク1コミットで進めてください。
AI に文字位置は返させない・検証は fail-closed・holes には書かない、の3点を外さないでください。
```

---

## 8. 一次資料（この順で当たる）

1. `docs/superpowers/specs/2026-09-02-recall-engine-design.md` … 主張・SRS・テーブル・公開範囲（土台。まずこれ）
2. `docs/superpowers/specs/2026-09-04-recall-dex-design.md` … いまの玄関（標本帳）と点の見せ方
3. `docs/superpowers/specs/2026-09-05-recall-replan-design.md` … いまの分野ページ・説明・隠しコマンド（最新の見せ方）
4. `docs/superpowers/specs/2026-09-07-recall-hole-suggestion-design.md` … 次の作業
5. `docs/superpowers/specs/2026-09-03-seven-cores-design.md` … 7族の芯
6. `docs/superpowers/specs/2026-09-04-recall-planet-ux-design.md` … 惑星（隠しコマンドの中身。決定1〜14）
7. `docs/superpowers/specs/2026-09-03-recall-furui-brief.md` … 振るい落とし（未決）
8. `docs/superpowers/specs/2026-09-03-cycle-skeleton-design.md` … 双輪サイクルの中での位置
9. `.superpowers/sdd/progress.md` … 定着エンジン実装時のタスクごとの実測と申し送り（実データで見つかった不具合の記録）
