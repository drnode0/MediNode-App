# Recall「標本帳」実装計画

> **実装する人へ:** このファイルは `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` で
> 1タスクずつ進める前提で書いてある。手順は `- [ ]` のチェックボックス。段の順は守る（前の段が緑になってから次へ）。

日付: 2026-09-04
状態: **未着手。** 設計はオーナー承認済み（2026-09-04 夜・案C）。実装は次のセッション（大きいモデル）で行う
設計: [標本帳（図鑑）設計](../specs/2026-09-04-recall-dex-design.md)（決定 D1〜D10）
先行: [惑星の中の体験](../specs/2026-09-04-recall-planet-ux-design.md)（近景の描画はそのまま使う）／
[七つの族の芯](../specs/2026-09-03-seven-cores-design.md)／
ラフ（案C の見た目の基準）: https://claude.ai/code/artifact/9bea9ec5-98df-4ea8-b4f0-249d345403d0

**目的:** Recall の玄関を惑星（環状）から標本帳（1分野＝1枚）に差し替え、分野ページ・確かめる・隠しコマンド（浮き出る球体）までを通す。

**方針:** 段を7つに分ける。段1（純関数）と段2（一覧）までで `RecallScreen` を差し替えるが、
分野ページが無い段2の時点では一枚を押しても何も起きない。その状態を本番へ出さない（push は段7でだけ）。
惑星のコード（`RecallField` / `field*.ts`）は**消さず・書き換えず**、段5の隠しコマンドで使う。

**技術:** Next.js App Router / React 18 / Canvas 2D（紋章と隠しコマンドだけ）/ Tailwind / Supabase / Vitest

---

## 全体の制約

- **テストは DOM を持たない**（`vitest.config.ts` に environment 無し・`@testing-library/*` 無し）。
  判断のロジックは `src/lib/recall/` の純関数に出し、それをテストする。React 部品は薄く保つ
- **設計書 D1〜D10 を実装で動かさない。** 迷ったら設計書に戻り、無いことは「実装時に確認すること」に足す
- **線画。** 面・塗り・影を使わない（点の塗りは線の色の濃淡。金は離れかけだけ）
- **画面の語**: 主張／残した／深く残した／読んだ／未着手／離れかけ／確かめる／記事／節／分野。
  「定着」「惑星」「輪」「振る」「拾う」「血肉」「落ちる」を UI 文言に出さない。ダッシュ「」を使わない
- **記録の意味を変えない。** `recall_progress` / `recall_section_reads` / `srs.ts` の段は触らない。段6（任意）だけ同期を触る
- **動きを減らす設定**（`useReducedMotion`）: 紋章の芯は止める（`drawCore3D` の `reduced`）。隠しコマンドの出方・戻りは即時。点の濃さの遷移も無し
- **公開リポ。** 事業数値・登録者数・売上をコード・コミット文・計画に書かない
- **見た目の判断は playwright のスクショで行う**（記憶 `playwright-screenshot-for-visual-check`）。Browser pane の小さな画像で色・太さを断定しない
- **worktree を使うなら**（記憶 `shared-worktree-branch-collision`）、`launch.json` の dev server は共有側を向く（記憶 `worktree-cannot-preview-in-browser-pane`）。
  worktree 内で `npx next dev -p 3211` を Bash の background で立て、playwright はそのポートを撮る。main で作業するなら 3210 のまま

---

## 変えないファイル（読むだけ）

`src/lib/recall/field.ts`／`field-camera.ts`／`field-angle.ts`／`cores.ts`／`core-shapes.ts`／`genres.ts`／`srs.ts`／
`segments.ts`／`holes.ts`／`sync-claims.ts`（段6を除く）／`src/components/recall/RecallField.tsx`（段5で prop を1つ足す以外）／
`RecallCard.tsx`／`RecallProvider.tsx`／`useFieldData.ts`／`src/app/page.tsx`（`RecallScreen` の差し込みはそのまま）

---

## 段0. 準備

- [ ] 設計書を読む。特に §2（画面）・§3（点）・§5（部品）・§9（用語）
- [ ] `npx vitest run` で緑を確かめる（2026-09-04 時点 1839 件）。`npm run build` も通ることを見る
- [ ] `/dev/recall-screen` を playwright で撮り、着手前の姿を scratchpad に残す（ライト・ダーク・1280 幅・390 幅）。
  撮り方は記憶 `playwright-screenshot-for-visual-check` の手順（`<html>.dark` の付け外しでテーマを切る）
- [ ] ラフを開き、案C（PC・スマホ枠・Node Field テーマ）と分野ページを見て、目標の姿を頭に入れる

---

## 段1. 純関数（テストが先）

### 1-1. 英名の表 `src/lib/recall/genre-en.ts`

- [ ] 設計書 §4 の表をそのまま `GENRE_EN: Record<string, string>` にする。キーは `canonicalGenreKey(席名)`（`KIND_BY_SEAT` と同じ作り）
- [ ] `genreEnglishOf(slot: number): string`。`OTHER_SLOT` → 'Others'。席の外・表に無い → ''
- [ ] `coreEnglishOf(kind: CoreKind): string`。内部名の先頭を大文字に（Flow / Exchange / Signal / Invasion / Structure / Regulation / System）
- [ ] テスト `src/lib/__tests__/recall-genre-en.test.ts`: 廃番（`RETIRED_SEATS`）以外の全席に英名がある／重複しない／63番が Others／族7つ／席の外は ''

### 1-2. 点の見た目とトレイ `src/lib/recall/dex.ts`

```ts
export type DotKind = 'cold' | 'touched' | 'kept' | 'settled' | 'escaping'
export type DotLook = { kind: DotKind; alpha: number }
export function dotLookOf(state: RecallState): DotLook
//  cold 0.35 / touched 0.55 / kept 0.5+0.45×remaining / settled 1 / escaping（isEscaping）1
export type TrayLayout = { size: 6 | 4; gap: 3 | 2; perRow: number; rows: number; shown: number; rest: number }
export const TRAY_MAX_ROWS = 6
export function trayLayout(n: number, widthPx: number): TrayLayout
//  6px+3px で perRow=floor((w+3)/9)。rows=ceil(n/perRow)。6 行を超えたら 4px+2px で計算し直す。
//  それでも超えたら shown=perRow×6、rest=n−shown（画面は「ほか rest」を出す）
```

- [ ] `dotLookOf` は `field-layout.ts` の `lookOf` と同じ向き（保持力が高いほど濃い）。`isEscaping` をそのまま使う
- [ ] テスト `src/lib/__tests__/recall-dex.test.ts`: 5段の alpha／保持力 1 と 0.3 の kept の大小／escaping が kept より優先／
  `trayLayout(34, 240)`＝6px・1行 26 個・2行／`trayLayout(178, 240)`＝4px（6px だと 7 行）・shown 178・rest 0／`trayLayout(300, 240)`＝rest > 0／幅 0 でも perRow ≥ 1

### 1-3. 一枚・分野ページ・今日の帯のモデル（同じ `dex.ts`）

```ts
export type PlateModel = { slot; label; en; kind; kindEn; n; kept; settled; touched; cold; escaping; tray: Array<{ claimId; look }> }
export function plateOf(planet: Planet): PlateModel
//  tray の並び＝planet.dots を angle 昇順（fanOf の角度。角度が同じなら claimId）
export function platesOf(planets: Planet[]): { used: PlateModel[]; empty: Array<{ slot; label; en }> }
//  used＝n>0 を席番号順。empty＝n=0 を席番号順。廃番は planets に無い（fieldLayout が落としている）

export type PageModel = { plate: PlateModel; pages: Array<{ pageId; title; n; revised: boolean; sections: Array<{ sectionKey; heading; rows: Array<{ claimId; body; look }> }> }> }
export function pageModelOf(planet: Planet, claimById: Map<string, RecallClaim>, revisedSince?: Date): PageModel
//  記事の順＝planet.pages（fanOf の pages）の順。記事の中は節キーの番号順（sectionOrderOf）→ 作成順 → claimId。
//  revised は段6まで常に false（引数は先に切っておく）

export type TodayModel = { escaping: number; seats: number; next: NextDue | null; notice: string | null }
export function todayOf(plates: PlateModel[], next: NextDue | null, now: Date): TodayModel
//  escaping＝合計、seats＝離れかけ>0 の分野数。escaping=0 のとき notice＝checkNotice(0, next, now)（分野名なし）
```

- [ ] テスト: `plateOf` の件数の内訳が dots と一致／tray が角度順／`platesOf` の used と empty の分け方と順／
  `pageModelOf` の記事の順が `planet.pages` と一致・節が番号順・読めない節キーは末尾／`todayOf` の 0 件の一言
- [ ] `useFieldData` の `Planet` 型（`field-render.ts` の `Planet`）をそのまま受ける。`dex.ts` は canvas を import しない
  （`field-render.ts` から型だけ `import type`）

### 1-4. 一言の文言 `src/lib/recall/notice.ts`

- [ ] `checkNotice` の「この惑星に、」を「この分野に、」に改める。「まだ残した主張がありません。主張を開いて…」の文言もそのまま分野版に
- [ ] `src/lib/__tests__/recall-notice.test.ts` の期待値を直す（文言の変更だけ。日数の条件は触らない）

### 1-5. 色 `src/lib/recall/field-palette.ts` と `field-layout.ts`

- [ ] `DARK_PALETTE` を緑の組に: `bg '#0d3a2b'`／`label '#B9CDC3'`／`outline '#F2F5F1'`／`labelBg 'rgba(13,58,43,.8)'`。`inks` は変えない
- [ ] `FieldPalette` に `alphaGain: number` を足す（ダーク 1・ライト 1.6）。`inkOf` は変えない
- [ ] `field-layout.ts` に `gainAlpha(alpha: number, gain: number): number`（`Math.min(1, alpha × gain)`）を足す
- [ ] `field-render.ts` の `drawField` で、点の `alpha`・輪郭の `outlineAlpha`・モヤの `HAZE_ALPHA` に `gainAlpha(…, pal.alphaGain)` を掛ける（3か所。式は持ち込まない）
- [ ] テスト: `recall-field-palette.test.ts` に緑の bg と gain の値／`recall-field-layout.test.ts` に `gainAlpha` の頭打ち／
  `recall-render.test.ts` に「ライトの palette を渡すと点の alpha が 1.6 倍（頭打ち 1）」を偽 ctx で1件
- [ ] `npx vitest run` 緑・`npx tsc --noEmit` 緑

---

## 段2. 紋章と一覧（`RecallScreen` を差し替える）

### 2-1. 紋章 `src/components/recall/CoreEmblem.tsx`

- [ ] `Props = { slot: number; kind: CoreKind; size: 72 | 96; className?: string }`。`<canvas>` 1つ。dpr は `min(devicePixelRatio, 2)`
- [ ] 描画は `drawCore3D({ cx, cy, CR: size×0.36×ind.scale, kind, t: t×ind.rate, reduced, yaw: t×ind.rate×CORE_SPIN[kind], pitch: ind.tilt, palette })`
  ＋ 半径 size×0.47 の薄い輪郭（alpha 0.5）。`ind = coreIndividual(slot)`（ラフ `drawEmblem` と同じ値）
- [ ] **rAF は部品ごとに持たない。** `src/components/recall/emblem-loop.ts` に 1本の scheduler を置き、登録された描画関数を
  1フレームで順に呼ぶ。`IntersectionObserver` で画面外の紋章は呼ばない。`document.hidden` で止める。
  **30fps に間引く**（`now - last < 33` なら描かない）。動きを減らす設定では 1 回だけ描いて止める
- [ ] テーマは `isDarkNow()` を毎フレーム見て `paletteOf` を選ぶ（`RecallField` と同じ理由: フックの初回値で白く光る）
- [ ] 実装時に確認: 15 枚同時で 1 フレーム何 ms か（`performance.now()` で 1 回測って scratchpad に残す）。8ms を超えるなら
  `drawCore3D` の `density` を 72px では下げる（`coreLayers` の `density` 引数）

### 2-2. 一覧 `src/components/recall/RecallDex.tsx`

- [ ] `Props = { plates: PlateModel[]; empty: …; today: TodayModel; counts; total: number; onOpen(slot); onSweep() }`
- [ ] 見出し（設計 §2.1）: 「Recall」・「検証済みの主張 n　濃いほど、自分のもの」・右に 残した／深く残した／読んだ
- [ ] 今日の帯: 離れかけ n（m分野）・次の期限（`next` から日数）・ボタン「離れかけを順に確かめる」。0件なら `notice` の一言だけ
- [ ] 一枚（設計 §2.2）: 枠 1px（`border` と `::before/::after` の角の印）・`CoreEmblem 72`・和名 17px・英名 11px 字間 .12em 大文字・族 英語・
  トレイ（`trayLayout` の size/gap で `<i>` を並べ、`rest>0` なら「ほか n」）・件数の行。`<button>` 1つで一枚全体を押せる（`aria-label` に和名）
- [ ] 点の CSS: `.cold/.touched` 輪郭のみ・`.kept` 塗り（`style={{opacity: look.alpha}}`）・`.settled` 塗り＋外輪（`box-shadow: 0 0 0 1.5px`）・
  `.escaping` 金の塗り＋滲み（`box-shadow: 0 0 6px`）。色は Tailwind の `text-slate-800 dark:text-[#F2F5F1]` を `currentColor` で受ける。金は `#A86B0C` / dark `#F0D68A`
- [ ] 列: `grid-cols-1 min-[560px]:grid-cols-2 gap-4`。空の席は末尾に一行（薄い文字・押せない）
- [ ] 書体はアプリ既定（`Noto Sans JP`）。インラインの `fontFamily` 指定を置かない

### 2-3. 画面 `src/components/recall/RecallScreen.tsx`（書き直し）

- [ ] `fixed inset-0` をやめ、通常のブロックにする。`data-app-header` の実測・`bottomRef` の実測・`shelfBottom`・帯・「外から／中心から」・凡例・棚を**すべて外す**
- [ ] 状態: `view: { kind: 'dex' } | { kind: 'page'; slot } `／`card`／`quiz`（段4）／`lift`（段5）。段2では `dex` だけ。一枚を押したら `view` を page にする（段3で中身が付く）
- [ ] `useFieldData` から `planets` を受け、`platesOf` / `todayOf` でモデルを作る（`useMemo`）
- [ ] 地の色: `bg-[#F5F7FA] dark:bg-brand-900`。`min-h-[70vh]`
- [ ] `/dev/recall-screen` を開き、playwright で 1280 幅と 390 幅、ライト・ダークを撮って設計 §2.2 の姿になっているか見る。
  紋章が回っていること（2枚のスクショで芯の向きが違う）を確かめる
- [ ] コミット（例: `feat(recall): 玄関を標本帳に差し替える（一覧まで）`）。**push しない**

---

## 段3. 分野ページ

### 3-1. `src/components/recall/RecallPlatePage.tsx`

- [ ] `Props = { model: PageModel; onBack(); onCheck(); onRow(claimId, look); onEmblem(); onRead(pageId, title) }`
- [ ] 見出し（設計 §2.4）: `CoreEmblem 96`（`<button aria-label="球体を浮き出す">` で包む。段5まで押しても何も起きない）・和名 26px・英名・族・件数・離れかけ（金）・
  ボタン「この分野を確かめる（n）」と「戻る」
- [ ] 記事の見出し: `pageTitle`・主張数・「改訂あり」（`revised` のときだけ・段6まで出ない）・右に「記事を読む ›」
- [ ] 節の小見出し: `heading`（空なら出さない）。行: 点 9px・本文（`line-clamp-2`）・状態の語（`hidden min-[560px]:inline`）。
  行は `<button>`、高さ 44px 以上、`border-b` の薄い線で区切る
- [ ] 「記事を読む」: `useReader().open({ objectID: pageId, title: pageTitle, notionUrl: '', owner: 'subscription' })`。
  **実装時に確認**: `RecallClaim.pageId` の形がリーダーの `objectID`（`/api/subscription/page?id=`）に通るか。
  `reader-claims.ts` は `normalizePageId` で両者を突き合わせているので、逆向き（claims の pageId をそのまま id に渡す）が通るかを実データで 1 件開いて見る。
  通らなければ `normalizePageId` の逆（ハイフン付きに戻す）を `dex.ts` に足してテストする
- [ ] 行のタップ: `look.kind==='escaping'` → `RecallCard` quiz、それ以外 → view。`RecallCard` の `kept` は `progressById`（既存の判定）
- [ ] 答えたあと（段4で本格化）・残すを押したあとは、`useFieldData` の再計算で `model` が変わり、点の濃さが変わる。
  点に `transition: opacity .6s` を付ける（`motion-reduce:transition-none`）

### 3-2. `RecallScreen` に組み込む

- [ ] `view.kind==='page'` のとき `RecallDex` を `hidden` にして `RecallPlatePage` を出す（アンマウントしない。戻ったときスクロール位置を保つ）。
  `hidden` の一覧の紋章は `IntersectionObserver` で描かれない（段2-1 の設計どおり）
- [ ] 「戻る」で `dex` へ。ブラウザの戻るは扱わない（タブの中の画面なので）
- [ ] 分野ページを開いている間に主張が外れて `model` の行が消えたら、開いているカードの `claimId` が `claimById` に無いときカードを閉じる
- [ ] playwright で分野ページ（ライト・ダーク・390 幅）を撮る。行の高さ・2行切り・金の行を見る
- [ ] コミット

---

## 段4. 確かめる（D7）

### 4-1. 列（キュー）のロジックを純関数に `src/lib/recall/dex-quiz.ts`

```ts
export type QuizRun = { slot: number; queue: string[]; index: number; answered: number; sweep: boolean }
export function startRun(slot: number, candidateIds: string[], sweep: boolean): QuizRun | null   // 0 件なら null
export function advance(run: QuizRun): QuizRun | null          // 次のカードへ。無ければ null（終わり）
export function nextSweepSlot(plates: PlateModel[], current: number | null): number | null   // 離れかけのある分野を席番号順に。current の次。無ければ null
export function runSummary(run: QuizRun, next: NextDue | null, now: Date): string   // 「n件を確かめました。次は○日後に○件」
```

- [ ] テスト `src/lib/__tests__/recall-dex-quiz.test.ts`: 0 件で null／advance が末尾で null／sweep の次の分野（末尾の次は null・現在が null なら先頭）／summary の日数（`checkNotice` と同じ二重の歯止め）

### 4-2. 画面の流れ

- [ ] 「この分野を確かめる」: `candidatesOf(slot)` → `startRun`。`RecallCard` quiz を `queue[index]` で出す。カードの上に「index+1 / queue.length」の小さな表示（`RecallCard` は変えず、画面側で重ねる）
- [ ] `onAnswer`: `review(claimId, result)` を待つ（失敗したら一言を出してカードは閉じない・既存と同じ）。成功したら `advance`。null なら `runSummary` の一言
- [ ] 「閉じる」: 途中でやめる。答えた分だけ記録が残る（既存どおり）。`run` を捨てる
- [ ] 「離れかけを順に確かめる」（一覧の帯）: `nextSweepSlot(plates, null)` → その分野ページへ移って `startRun(…, sweep=true)`。
  終わったら `nextSweepSlot(plates, slot)` で次へ。null なら一覧へ戻り「今日の離れかけを確かめました」
- [ ] 候補 0 件のとき: `checkNotice(0, nextDueOf(slot), now, label)` の一言（段1-4 の「この分野に、」）
- [ ] playwright で: 確かめる → 覚えた → 行の点が濃くなる、を撮る（`/dev/recall-screen` の仮 API は成功を返す）
- [ ] コミット

---

## 段5. 隠しコマンド（D5・浮き出る球体）

### 5-1. `RecallField` に「最初から近景」を足す（変更はこの1点だけ）

- [ ] `Props` に `initialNear?: number`（席番号）を足す。あれば `useEffect` の初期化で `goStage('near', initialNear)` 相当を**飛ばずに**置く
  （`cam.current = cameraFor(initialCamera(seats), center, 'near', seat)`・`stage.current='near'`・`nearSlot.current=slot`・`enteredAt=now`）。
  中景を経由しない。既存の `enterNear` / `backToMid` / ドラッグ・慣性・見下ろし・点のタップはそのまま効く
- [ ] 近景で `backToMid` が呼ばれる経路（ホイール下・ピンチイン・背景タップ）は、覆いの中では**閉じる**に読み替える。
  `onStage('mid', null)` を受けたら `RecallLift` が `onClose()` を呼ぶ（`RecallField` は変えない）

### 5-2. `src/components/recall/RecallLift.tsx`

- [ ] `Props = { slot: number; planets: Planet[]; origin: { x: number; y: number }; onClose(); onDotTap(claimId) }`
- [ ] `fixed inset-0 z-20`。地は `bg-[#F5F7FA]/[.92] dark:bg-brand-900/[.92]`。中に `RecallField`（`center='outside'`・`initialNear=slot`・`shelf=[]`・`lensPageId` は自前の state）
- [ ] 出方: `transform-origin` を `origin`（紋章の中心・`getBoundingClientRect` から）に置き、`scale(.2)→1`・`opacity 0→1` を 500ms `cubic-bezier(.16,.9,.3,1)`。
  戻りは 350ms の逆。`useReducedMotion` なら遷移なし。紋章側は浮き出ている間 `opacity-30`
- [ ] 閉じる: 背景の `<button aria-label="戻る">`（canvas の外側は無いので、下に「戻る」ボタンを置く）・Esc・`onStage('mid')`。
  タブを離れたら（`document.hidden`）閉じる
- [ ] 点のタップ → `RecallCard` view（`RecallScreen` の `card` を使う。カードは `z-30` なので覆いの上に出る）
- [ ] 上に小さく和名・英名だけ（見出しの内訳は出さない。球体を眺める画面なので）
- [ ] z の順: 覆い 20・カード 30・アプリのヘッダー 10。**覆いはヘッダーを隠す**（タブへ戻れないのは閉じるまでの間だけで、Esc と戻るがある）。
  実装時に確認: iOS Safari で `fixed` の覆いがスクロール位置に追従すること
- [ ] playwright で: 紋章タップ → 覆いが出る → 1 秒後に芯の向きが変わっている（回っている）を撮る。ライト（`alphaGain 1.6`）で点が読めるか見る
- [ ] コミット

---

## 段6. 改訂の旗（任意・D10。時間が無ければ飛ばして段7へ）

- [ ] 同期 `sync-claims.ts`: 既存行の `body` と抽出結果の `body` が違う主張に `revised_at: now` を書く（`holes` の差分の読み方と同じ場所で判定）。
  変わっていない主張は保存されている `revised_at` を書き戻す（`holes` と同じ理由: upsert のキーの和集合で NULL に潰れる）
- [ ] `src/app/api/recall/claims/route.ts` の select に `revised_at` を足し、`RecallClaim.revisedAt?: string` に写す（`types.ts`）
- [ ] `dex.ts` の `pageModelOf(…, revisedSince)`: 記事の中に `revisedAt >= revisedSince` の主張があれば `revised=true`。`revisedSince` は画面側で「30日前」
- [ ] テスト: `recall-sync-claims.test.ts` に「本文が変わった行だけ revised_at が now」「変わらない行は書き戻し」／`recall-dex.test.ts` に旗の判定
- [ ] 実装時に確認: 初回同期で全主張の `body` が「新規」扱いになり全部に旗が立たないこと（既存行が無いときは `revised_at` を書かない）
- [ ] コミット

---

## 段7. 仕上げと本番

- [ ] `RecallScreen` の旧コード（帯・視点切替・凡例・棚・ヘッダー実測）が残っていないか読み直す。`recall.center` の `localStorage` は読まない
- [ ] `useReducedMotion` で: 紋章静止・遷移なし・点の遷移なし、を `/dev/recall-screen` に `prefers-reduced-motion` を付けた playwright で撮って確かめる
- [ ] キーボード: 一枚・行・ボタンが Tab で回れて Enter で押せる。フォーカスの輪が見える（`focus-visible:ring`）
- [ ] `npx vitest run`・`npx tsc --noEmit`・`npx next lint`・`npm run build` が緑
- [ ] `/dev/recall-screen` を 1280 幅・390 幅・ライト・ダーク・分野ページ・確かめる・隠しコマンドで撮り、設計 §2 と突き合わせる（可視テキストを上から順に）
- [ ] 記憶 `recall-dex-decision-2026-09-04` に実装の到達点を追記。`medinode-app-implementation-index` に標本帳の行を足す
- [ ] **push はオーナーの承認を取ってから**（本番の Recall タブが惑星から標本帳に変わる。オーナー専用フラグは変えない）
- [ ] 本番で: ライト・実機（スマホ）で一覧→分野→確かめる→隠しコマンド→戻るを 1 周し、他のタブへ戻れることを見る

---

## 実装時に確認すること（設計書に無い・実機で決まる）

| 項目 | 見る場所 | 決め方 |
|---|---|---|
| 15 枚の紋章の描画コスト | 段2-1 | 8ms/フレームを超えたら 72px の `density` を下げる。それでも重いなら一覧は 15fps |
| `pageId` がリーダーの `objectID` に通るか | 段3-1 | 実データで 1 記事開く。通らなければ逆正規化を `dex.ts` に足す |
| トレイの幅 | 段2-2 | `trayLayout` に渡す幅は一枚の実測（`ResizeObserver`）か、列の固定幅（1列 ≈ 560px・2列 ≈ 270px）か。まず固定幅で始め、崩れたら実測 |
| 分野ページの本文 2 行切り | 段3-1 | 実データの主張は 1 文が長い。2 行で切れて意味が読めないなら 3 行にする |
| 隠しコマンドの iOS Safari | 段5-2 | `fixed` 覆いと `touch-none` の効き。ピンチインで閉じる経路が iOS の拡大と競合しないか |
| 「改訂あり」の期間 | 段6 | 30 日で始める。旗が多すぎたら「最後に残した日より後」に変える |

## 段の見積もり（目安）

段1 半日／段2 半日／段3 半日／段4 半日／段5 半日／段6 半日（任意）／段7 数時間。1セッションで段5まで通せる分量。
