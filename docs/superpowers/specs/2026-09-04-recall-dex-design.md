# Recall｜標本帳（図鑑）設計

日付: 2026-09-04
状態: **オーナー決定済み（2026-09-04 夜・案C）。** 実装は次のセッション（計画 `../plans/2026-09-04-recall-dex-plan.md`）。
ラフ（コードで回る現物。芯と近景は出荷コードそのもの）: https://claude.ai/code/artifact/9bea9ec5-98df-4ea8-b4f0-249d345403d0
先行資料: `2026-09-04-recall-planet-ux-design.md`（惑星の中の体験・決定1〜14）／`2026-09-03-seven-cores-design.md`（芯）／
`2026-09-02-recall-engine-design.md`（記憶の状態・SRS・席）／`2026-09-01` 練り直しの骨格（記憶 `medinode-futatsu-no-wa-2026-09-01`）

---

## 0. この設計書が扱うこと

Recall の**玄関（開いたときの画面）と、分野の中の見せ方**を、惑星（環状）から**標本帳**へ改める。
記録の意味（`recall_progress` / `recall_section_reads` / SRS の段）と、主張の同期は変えない。
芯（7族・`core-shapes.ts` / `cores.ts`）と近景の描画（`field-render.ts` / `RecallField.tsx`）は変えずに、
置き場所だけ変える。

### なぜ変えるか（ラフで測った事実）

| 事実 | 出所 |
|---|---|
| 遠景（1.5倍・傾き −0.18）では輪が上下2本の横線に潰れ、真ん中が空洞になる | 本番のスクリーンショット（ダーク・ライト） |
| 惑星名は 10px・60% で、しかも「遠景では名前を出さない」が 09-04 の決定だった | `field-render.ts` の `LABEL_MIN_R`／設計書 09-04 §4 |
| ライトでは未着手 20%・輪郭 16% からの薄さが紙の上で消える | `field-layout.ts` の `lookOf`／`planetSummary` |
| 星図（案A）に直しても、スマホ幅では輪が 360px に縮み、惑星が半径 5〜13px で名前が重なる | ラフ「案A・スマホ枠」 |
| 37席のうち 22席が空で、遠景の6割がモヤになる | `HAZE_ALPHA` の注記／`/dev/recall-screen` の仮データ |

図鑑にすると、Recall が実際に持っている情報がそのまま画面に写る（下表）。惑星では距離の比喩に翻訳して
「境目の名前」で説明していたものが、点の濃さと行の並びで説明なしに読める。

| Recall が持っている情報 | 惑星での見せ方 | 標本帳での見せ方 |
|---|---|---|
| 分野ごとの主張の在庫と、残した割合 | 惑星の大きさと輪郭の明るさ | 点の並び（トレイ）と件数 |
| 記憶の5段（未着手／読んだ／残した／深く残した／離れかけ） | 輪からの距離。境目の名前を3秒出す | 点の濃さ。凡例なしで読める |
| 離れかけ（確かめる対象・保持力 0.28 未満） | 光る点。寄らないと数が分からない | 金の点と件数。行にもそのまま並ぶ |
| 記事と節の入れ子 | 近景の扇形 | 見出しと行。読む単位そのもの |
| 改訂（骨格で決めた「鮮度で旗」） | 置き場が無い | 記事の見出しに旗 |
| 未着手 | 霧（読みに行く先として意識されない） | 「まだ集めていない標本」として見える |

### 09-01 の「図鑑UI却下」との関係

09-01 に却下した図鑑は「定着（血肉）を確かめる手段」としての図鑑で、その役目は球（のちに惑星）が担うことになった。
今回の図鑑は**入口と一覧**で、定着を確かめる手段は変わらず「確かめる」（カード）が担う。性質が違うので採用する。
再検討ライン: **標本帳にしてから、離れかけを確かめた回数が球・惑星のときより減ったら**、見せ方を戻す。

---

## 1. 決定（2026-09-04・本人）

| 番号 | 決定 | 補足 |
|---|---|---|
| D1 | 玄関＝標本帳。**1分野＝1枚**。主張のある席だけ並べ、**席番号順で固定**。空の席は末尾に一行で畳む | 図鑑は並びが動かないことで場所を覚えられる。離れかけ順に並べ替えない |
| D2 | 惑星（環状・遠景・中景・帯・視点A/B）は主動線から退く。**コードは消さない**（球と同じ扱い） | `RecallField.tsx` は隠しコマンド（D5）で使う |
| D3 | 芯＝**紋章**として残す。一覧 72px・分野ページ 96px | 針金細工が最もきれいに見える大きさ。族の動きは止めない |
| D4 | 分野名は**和名＋英名**。族名は**英語**（Flow / Exchange / Signal / Invasion / Structure / Regulation / System） | `CORE_LABEL` の日本語は画面に出さない（内部名・テストは据え置き） |
| D5 | **隠しコマンド**: 分野ページの紋章を押すと、球体が画面から浮き出て、指で回せる。戻ると紋章に収まる | 既存の近景（`RecallField` の near）を流用。ドラッグ・慣性・見下ろしはそのまま |
| D6 | Recall のダーク＝**Node Field の緑**（アプリの brand-900 `#0d3a2b` 系）。ライトはアプリの紙 `#F5F7FA` のまま | 線画の原則（面・塗り・影を使わない）は不変 |
| D7 | 確かめる＝分野ページの「この分野を確かめる」。**棚（canvas の弧）は廃止**し、カードを1枚ずつ順に出す（最大5） | 候補の選び方（`pickCandidates`）は不変 |
| D8 | 記憶の見せ方＝**点の濃さ**。居場所5段を点の見た目に写す。境目の名前（09-04 決定7）は不要になる | 明るさ＝保持力の向き（09-04 で直した向き）を保つ |
| D9 | **星図（案A）は不採用。** ラフに残し、他のアプリへの転用候補にする | 本人「どこかで他のアプリで使うかも」 |
| D10 | 改訂の旗は `revised_at` 列（0029 で作成済み・未使用）を同期側で埋めてから出す。**任意の段**として計画に置く | 同期を触るので、見せ方だけの段とは分ける |

---

## 2. 画面

Recall タブは `page.tsx` の `max-w-2xl mx-auto px-4 py-4` の中に描かれる。いまの `RecallScreen` は
`fixed inset-0` で外へ出ているが、標本帳は**通常のスクロールする画面**にする（fixed にしない）。
これでヘッダーの高さの実測（`data-app-header`）も、下の束の実測（`shelfBottom`）も要らなくなる。
fixed で置くのは、隠しコマンドの覆い（D5）とカード（既存 `RecallCard`）だけ。

### 2.1 見出しと「今日」の帯

```
Recall                                   592 主張
検証済みの主張 592　濃いほど、自分のもの        残した 132 ／ 深く残した 18 ／ 読んだ 140

┌ 今日 ──────────────────────────────────────┐
│ 離れかけ 23（7分野）   次の期限 2日後に 4件    [離れかけを順に確かめる] │
└─────────────────────────────────────────┘
```

- 「離れかけを順に確かめる」＝いまの帯の「すべて」（`sweep`）。離れかけのある分野を席番号順に回り、
  1分野ずつ確かめる（混ぜない）。押すと最初の分野ページへ移り、そのまま確かめるが始まる
- 離れかけが 0 のときは帯の中身を「いま確かめる主張はありません。次は○日後に○件」（既存 `checkNotice`）にする
- 「中心に近いほど、自分のもの」の一文は惑星の比喩なので**外す**。代わりに「濃いほど、自分のもの」

### 2.2 一枚（plate）

```
┌──────────────────────────────────┐
│ ◯芯    救急蘇生  RESUSCITATION   Flow   │
│        ●●●○○●●○○○◎●○○●●●○○○○●●○     │
│        ●○○○                          │
│ 主張 34   残した 10   ● 離れかけ 1        │
└──────────────────────────────────┘
```

- 枠: 1px の線と、左上・右下の角の印（標本ラベルの型）。塗り・影・角丸なし
- 紋章: 72px の円の中で芯が族の動きで回る（`drawCore3D`・個体差 `coreIndividual` そのまま）
- 名前: 和名 17px／英名 11px・字間 0.12em・大文字／族 英語 11px・薄い
- トレイ: 主張1つ＝点1つ。**並びは扇形と同じ**（記事の初出順 → 記事の中は節の順 → 作成順。`fanOf` の順）。
  点の見た目は §3。点が多い分野は点を小さくして最大 6 行に収める（§3.3）
- 件数の行: 主張 n／残した（残した＋深く残した）／離れかけ（金・あるときだけ）
- タップで分野ページへ。トレイの点は一覧では押せない（6px は指で選べない）
- 列数: 幅 560px 以上で 2 列、それ未満で 1 列（`max-w-2xl` の中なので最大 2 列）

### 2.3 空の席

一覧の末尾に一行。「まだ主張のない分野 22」と席名を薄く並べる。押しても何も起きない
（読みに行く入口はジャンルタブが担う。ここから飛ばすのは後で決める）。

### 2.4 分野ページ

```
◯芯96   救急蘇生   RESUSCITATION
        Flow　主張 34 ・ 残した 9 ・ 深く残した 1　離れかけ 1
        [この分野を確かめる（1）]  [戻る]
────────────────────────────────────────
救急蘇生の記事 1  17                     記事を読む ›
  第1節 初期評価
  ◎ 心停止の初期評価では …（本文2行まで）        深く残した
  ● 初期輸液は 30 mL/kg を …                     残した
  ○ …                                          未着手
  第2節 …
救急蘇生の記事 2  17   [改訂あり]               記事を読む ›
```

- 見出し: 紋章 96px（**ここを押すと隠しコマンド D5**）・和名 26px・英名・族・件数
- 記事ごとの見出し（`pageTitle`・主張数・改訂の旗 D10・「記事を読む」）。「記事を読む」はアプリ内リーダーを開く
  （`useReader().open({ objectID: pageId, title: pageTitle, notionUrl: '', owner: 'subscription' })`）
- 節の小見出し（`sectionHeading`）。行＝主張1つ: 点・本文（2行で切る）・状態の語（PC のみ。スマホでは点だけ）
- 行をタップ: 未着手／読んだ／残した／深く残した → `RecallCard` の view（原文＋出典＋残す）。
  離れかけ → `RecallCard` の quiz（伏せ字）。答えると行の点がその場で濃くなる（600ms の遷移）
- 節の「読んだ」は行に出さない（読んだは主張の状態として点に出る。節の読了ボタンはリーダー側にある）
- 「戻る」で一覧へ。一覧はアンマウントせず（表示を切り替えるだけ）、スクロール位置を保つ

### 2.5 確かめる（D7）

1. 「この分野を確かめる」を押す。候補＝`candidatesOf(slot)`（最大5・保持力の低い順）
2. 候補が 0 なら `checkNotice` の一言（「この分野に、いま確かめる主張はありません。次は○日後に○件」）
3. カードを 1 枚ずつ出す。カードの上に「2 / 5」。覚えた／まだ／閉じる
4. 覚えた: `review(ok)`。行の点が濃くなる（保持力 1 の見た目）。まだ: `review(ng)`。点は金のまま
5. 5枚目を答えたら「n件を確かめました。次は○日後に○件」。閉じるで途中でやめられる（記録は答えた分だけ）
6. 「離れかけを順に確かめる」（§2.1）から来たときは、この分野が終わると次の分野ページへ移って続ける。
   全分野が終わったら一覧へ戻り「今日の離れかけを確かめました」

保存の失敗は既存どおり（`saveError` を一言で出し、カードは閉じない）。

### 2.6 隠しコマンド（D5）

- 分野ページの紋章（96px）を**タップ**すると、覆い（fixed inset-0・地の色 92%）が出て、その中に既存の
  `RecallField` を**近景**で置く（`enterNear(slot)` 相当のカメラで初期化。中景を経由しない）
- 出方: 覆いの `transform-origin` を紋章の中心に置き、`scale(0.2) → scale(1)` を 500ms（イーズアウト）。
  同時に不透明度 0 → 1。紋章そのものは薄くなる（浮き出た、と読める）
- 中: 横ドラッグで輪と芯が回る（`handYaw`）・縦ドラッグで見下ろす・指を離すと慣性（既存）。
  記事の扇形と記事名、境目の名前も既存のまま出る。点のタップ → `RecallCard` view（既存 `onDotTap`）
- 戻り: 近景の背景タップ（既存の `backToMid` の経路を「閉じる」に読み替える）・「戻る」・Esc。逆の遷移 350ms で紋章へ収まる
- 動きを減らす設定: 出方・戻りは即時。芯の動きは既存どおり止まる
- 視点（外から／中心から）の切り替えは出さない。`localStorage` の `recall.center` は読まない（既定＝外から）
- 一覧の紋章（72px）は押しても何も起きない（一枚全体のタップ＝分野ページ）

### 2.7 テーマ（D6）

| | ライト | ダーク |
|---|---|---|
| 地 | `#F5F7FA`（アプリの soft） | `#0d3a2b`（brand-900・Node Field の緑） |
| 線・文字 | 紺 `#243650` 系（既存 `LIGHT_PALETTE`） | 白 `#F2F5F1`。薄い文字 `#B9CDC3` |
| 離れかけ（金） | `#A86B0C` | `#F0D68A` |
| 芯の色 | 既存 `LIGHT_PALETTE.inks` | 既存 `DARK_PALETTE.inks`（白の3温度） |

`field-palette.ts` の `DARK_PALETTE` の `bg` / `label` / `labelBg` を緑の組に改める（`inks` は変えない）。
Recall 画面の DOM 側は Tailwind の `dark:bg-brand-900` などで同じ色を使う。カード（`RecallCard`）は既存の色のまま。

**ライトの線の薄さ**は、ラフでは重ね描きで濃さを稼いだが、本実装では紋章とトレイが DOM と 72px の canvas なので
問題が小さい。隠しコマンドの近景（canvas）だけ、`FieldPalette` に `alphaGain`（ライト 1.6）を足して
`drawField` の点と輪郭の alpha に掛ける（式は `field-layout.ts` に出してテストする）。

### 2.8 文字

アプリの本文書体（`Noto Sans JP`・`layout.tsx` で読み込み済み）を使う。いまの `RecallScreen` が
インラインで指定している `Zen Kaku Gothic New` / `Shippori Mincho` は**読み込まれていない**（`layout.tsx` にも
`globals.css` にも無く、端末の代替書体で出ていた）ので、指定ごと外す。英名は同じ書体で字間を空ける。

---

## 3. 点（記憶の見せ方・D8）

`field-layout.ts` の `lookOf` と同じ向き（明るさ＝保持力）で、DOM の点に写す。

| 状態 | 判定 | 見た目（ライト／ダークとも線の色を使う） |
|---|---|---|
| 未着手 `cold` | 記録なし・節も未読 | 輪郭だけ。不透明度 0.35 |
| 読んだ `touched` | 節の読了あり・残していない | 輪郭だけ。不透明度 0.55 |
| 残した `kept` | 記録あり・保持力 ≥ 0.28 | 塗り。不透明度 `0.5 + 0.45 × 保持力` |
| 深く残した `settled` | 間隔 90 日以上 | 塗り。不透明度 1。外側に細い輪（後光） |
| 離れかけ | `kept`/`settled` で保持力 < 0.28 | 金の塗り。不透明度 1。淡い滲み（6px） |

- 「定着」は画面に出さない（09-04 決定9）。語は「深く残した」
- 金（暖色）は離れかけだけ。他は線の色の濃淡だけで分ける（芯と同じ原則）
- 動きを減らす設定でも点は静止（もともと明滅しない）

### 3.1 点の大きさ（一覧のトレイ）

一枚の幅から 1 行に入る数を出し、6 行を超えるなら点を 6px → 4px に落とす。それでも超えるなら
「ほか n」を右端に出す（4px・間隔 2px・幅 240px なら 1 行 40 個・6 行で 240 個。呼吸 178 は入る）。

```ts
trayLayout(n: number, widthPx: number): { size: 6 | 4; gap: 3 | 2; perRow: number; rows: number; shown: number }
```

### 3.2 並び

扇形と同じ（`fanOf` の `angles` の昇順＝記事の初出順・節の順・作成順）。同じ主張は同じ位置に居続け、
主張が増えても既存の点の相対順は変わらない（09-04 決定4 と同じ約束）。

### 3.3 分野ページの行の点

9px。見た目の規則は同じ。行の左に置き、行の高さはスマホで 44px 以上（指で押せる）。

---

## 4. 英名（D4）

表示だけに使う。同期・席番号・キーには使わない（席の正規化は `canonicalGenreKey` のまま）。
席名（番号を落とした正規化キー）で引く。`KIND_BY_SEAT` と同じ作りにし、改名のたびにここも直す。

| 席 | 英名 |
|---|---|
| 総論 | Overview |
| 医療倫理 | Medical Ethics |
| 救急蘇生 | Resuscitation |
| 呼吸 | Respiratory |
| 循環 | Cardiovascular |
| 中枢神経 | Neurology |
| 腎 | Renal |
| 肝・胆道系 | Hepatobiliary |
| 膵 | Pancreas |
| 消化管・その他腹部 | GI & Abdomen |
| 血液凝固線溶系 | Coagulation |
| 代謝内分泌 | Metabolic & Endocrine |
| 感染症 | Infection |
| 多臓器障害 | Multiple Organ Dysfunction |
| 外傷・整形 | Trauma & Orthopedics |
| 熱傷 | Burns |
| 急性中毒 | Toxicology |
| 体温異常・環境障害 | Thermal & Environmental |
| 妊産婦 | Obstetrics |
| 小児 | Pediatrics |
| 移植 | Transplantation |
| 輸液・輸血・水電解質 | Fluids, Blood & Electrolytes |
| 栄養 | Nutrition |
| 画像診断 | Imaging |
| ICU運営・医療安全・教育 | ICU Management & Education |
| 手技 | Procedures |
| 薬剤 | Pharmacology |
| 災害 | Disaster Medicine |
| 学会（廃番） | Conferences |
| 統計・研究 | Statistics & Research |
| 他科救急 | Other Specialties |
| リハビリ・PICS | Rehabilitation & PICS |
| 精神科 | Psychiatry |
| アレルギー・免疫 | Allergy & Immunology |
| 周術期・麻酔 | Perioperative & Anesthesia |
| 病院前・搬送 | Prehospital & Transport |
| 腫瘍・血液救急 | Oncologic & Hematologic Emergencies |
| 症候 | Symptoms & Signs |
| その他（63番） | Others |

族: `flow` Flow／`exchange` Exchange／`signal` Signal／`invasion` Invasion／`structure` Structure／
`regulation` Regulation／`system` System。`CoreKind` の内部名がそのまま英語なので、表示は先頭を大文字にするだけ。

英名は仮置き。**オーナーが表を直せば画面が変わる**。テストは「廃番以外の全席に英名があり、重複しない」だけを見る。

---

## 5. 部品の分け方

| 部品 | 置き場 | 役目 | 依存 |
|---|---|---|---|
| `genre-en.ts` | `src/lib/recall/` | 席の英名・族の英名（純関数・表） | `genres.ts` `cores.ts` `genre.ts` |
| `dex.ts` | `src/lib/recall/` | 一枚・分野ページ・今日の帯の**モデル**を作る純関数。点の見た目・トレイの配置・行のグループ化 | `field-layout.ts`（状態）`field-angle.ts`（並び）`srs.ts` `notice.ts` |
| `CoreEmblem.tsx` | `src/components/recall/` | 紋章 canvas。1つの rAF を共有し、画面外は描かない。dpr・reduced・テーマ | `field-render.ts` の `drawCore3D` |
| `RecallDex.tsx` | 同上 | 見出し・今日の帯・一枚の一覧・空の席 | `dex.ts` `CoreEmblem` |
| `RecallPlatePage.tsx` | 同上 | 分野ページ（見出し・記事・行） | `dex.ts` `CoreEmblem` `useReader` |
| `RecallLift.tsx` | 同上 | 隠しコマンドの覆い。`RecallField` を近景で置く | `RecallField.tsx`（`initialNear` を足す） |
| `dex-quiz.ts` | `src/lib/recall/` | 確かめるの列（キュー）と順に回る判断（純関数） | `dex.ts` `srs.ts` `notice.ts` |
| `emblem-loop.ts` | `src/components/recall/` | 紋章の共有 rAF（画面外は描かない・30fps・非表示で止める） | |
| `RecallScreen.tsx` | 同上 | 画面の状態（一覧／分野／確かめる／浮き出し）と `RecallCard` の出し入れ。**書き直す** | 上の全部・`useFieldData` |
| `useFieldData.ts` | 同上 | いまのまま（planets・band・counts・candidatesOf・nextDueOf）。標本帳もこれを読む | 変更なし |
| `field-palette.ts` | `src/lib/recall/` | ダークを緑の組に。`alphaGain` を足す | |
| `/dev/recall-screen` | `src/app/dev/` | いまのまま動く（`RecallScreen` を差し替えるので自動的に標本帳になる） | |

`RecallField.tsx` / `field.ts` / `field-camera.ts` / `field-render.ts` / `field-layout.ts` / `field-angle.ts` は
**変えない**（`alphaGain` の掛け算を `drawField` に足す1点を除く）。`RecallSphere` は退役済み。

### モデルの型（`dex.ts`）

```ts
export type DotLook = { kind: 'cold' | 'touched' | 'kept' | 'settled' | 'escaping'; alpha: number }
export type PlateModel = {
  slot: number; label: string; en: string; kind: CoreKind; kindEn: string
  n: number; kept: number; settled: number; touched: number; cold: number; escaping: number
  tray: Array<{ claimId: string; look: DotLook }>   // 扇形の順
}
export type PageModel = {
  plate: PlateModel
  pages: Array<{ pageId: string; title: string; n: number; revised: boolean
    sections: Array<{ sectionKey: string; heading: string
      rows: Array<{ claimId: string; body: string; look: DotLook }> }> }>
}
export type TodayModel = { escaping: number; seats: number; next: NextDue | null; notice: string | null }
```

---

## 6. 誤り・端の扱い

- 読み込み失敗で主張が 0: 画面いっぱいの一言（既存 `fatal`）。主張はあるが再読込に失敗: 上の一言（既存 `pill`）
- 保存失敗: カードは閉じず、一言を出す（既存）
- 主張が届く前: 一覧の骨だけ（見出しと「読み込んでいます」）。紋章は描かない
- 席の外（その他 63 番）に主張が落ちたとき: 「その他 Others」の一枚として末尾に出す（`genreLabel` が 'その他' を返す）
- 分野ページで、開いている間に同期で主張が外れた: 行は消える。カードが開いていれば閉じる（`claimById` に無い）
- 隠しコマンド中にタブを離れた: 覆いを閉じる（`RecallField` の rAF は `visibilitychange` で止まる）

---

## 7. テストの方針

テストは DOM を持たない（`vitest.config.ts` に environment 無し）。判断はすべて純関数に出す。

- `genre-en.ts`: 廃番以外の全席に英名がある・重複しない・その他が Others・族7つの英名
- `dex.ts`: 点の見た目（5段と保持力）・トレイの配置（6行の頭打ち・4px への切り替え・「ほか n」）・
  並びが `fanOf` と一致・記事→節→行のグループ化と順序・今日の帯（0件のときの一言・分野数）
- `field-layout.ts`: `alphaGain` を掛けた式
- `field-render.ts`: 偽 ctx で `drawField` が `alphaGain` を掛けていること（既存の `recall-render.test.ts` の作法）
- 画面は `/dev/recall-screen` を playwright で撮って見る（ライト・ダーク・スマホ幅・分野ページ・隠しコマンド）

---

## 8. 変えないこと・やらないこと

- 記録の意味、SRS の段、同期（D10 の段を除く）、機能フラグ（オーナー専用）
- 選択肢式のクイズ、AI の解説、ストリーク、ポイント（09-01 の却下）
- 分野ごとの線画イラスト（Node Field のジムの絵のようなもの）。再検討ライン: **主張のある分野が 20 を超えたとき**
- 空の席からジャンルタブへ飛ぶ導線（後で決める）
- 一覧の並べ替え・絞り込み（席番号順の固定を守る）

---

## 9. 用語

画面に出す語: 主張／残した／深く残した／読んだ／未着手／離れかけ／確かめる／記事／節／分野。
使わない語: 振る・拾う・血肉・落ちる・定着・惑星・輪・席（席は内部語）。ダッシュ「」を使わない。
