# タスク14 報告: 隠しコマンドの覆い RecallLift.tsx

## やったこと

`src/components/recall/RecallLift.tsx` を新規作成。Props は指示どおり
`{ slot: number; planets: Planet[]; origin: { x: number; y: number }; onClose(): void; onDotTap(claimId: string): void }`。

- `fixed inset-0 z-20`。地は `bg-[#F5F7FA]/[.92] dark:bg-brand-900/[.92]`
- 中に既存の `RecallField` を `center='outside'`・`initialNear={slot}`・`shelf=[]`（棚は隠しコマンドで使わないので
  空配列を固定参照で渡す）・`lensPageId` は自前の state・`cardOpen={false}` で置いた（下記「既知のこと」参照）
- 出方: 覆いの `transformOrigin` を `origin` に置き、`scale(.2)→1`・`opacity 0→1` を 500ms
  `cubic-bezier(.16,.9,.3,1)`。戻りは 350ms の逆（`closing` state で反転）。`useReducedMotion()` が true なら
  `transition: none` で即時
- 閉じる: 「戻る」ボタン・Esc・`RecallField` の `onStage` が `'near'` 以外を通知したとき
  （既存の背景タップ／ホイール下／ピンチインによる `backToMid` の経路をそのまま「閉じる」に読み替え）。
  `document.hidden` でも閉じる（この経路だけは遷移を再生せず即 `onClose`）
- Esc は、`RecallCard` の `role="dialog" aria-label="主張のカード"` が DOM に無いときだけ閉じる。
  カードが覆いの上に出ているときの Esc は、`RecallScreen` 側の既存の Esc（カードだけを閉じる）に譲る
  （両方同時に閉じてカードを閉じたつもりで球体からも弾き出されるのを防ぐための判断。設計書に明記は無いが、
  カードと覆いを両方持つのは今回が初めてなので実装時に決めた）
- 上に和名・英名だけ（`seat.label` と `genreEnglishOf(slot)`。件数の内訳は出さない）
- z: 覆い20・（カードは `RecallScreen` 側の既存 `RecallCard` がそのまま z-30 で上に乗る）

## `RecallPlatePage.tsx` / `RecallScreen.tsx` の配線

- `RecallPlatePage` の `onEmblem` を `() => void` から `(origin: { x: number; y: number }) => void` に変更。
  紋章ボタンの `onClick` で `e.currentTarget.getBoundingClientRect()` から中心を計算して渡す
- `liftOpen?: boolean` を足し、覆いが浮き出ているあいだ紋章に `opacity-30` を付ける（`transition-opacity`）
- `RecallScreen` に `lift` state（`{ slot; origin } | null`）を追加。`onEmblem` は `view.kind==='page'` のときだけ
  `setLift({ slot: view.slot, origin })`
- 隠しコマンドの点のタップは `claimId` しか来ないので、`data.planets` の `dots[].state` から
  `claimId → RecallState` の Map を作り、`dex.ts` の `dotLookOf` で「離れかけなら quiz・それ以外は view」を
  行タップ（`onRow`）と同じ基準で振り分けて `setCard` する
- 分野ページを離れる経路（同期で一枚が消えた／`onBack`／`openPage` で別分野へ乗り換え）では念のため
  `setLift(null)` も呼ぶ（覆いが古い席を指したまま残らないように）
- `RecallField.tsx` は変更していない（`git diff` で確認済み）

## 確かめ方（playwright・`http://localhost:3211/dev/recall-screen`）

1. 一覧→一枚→紋章（96px）タップ → 覆いが出た（`dex14-02-open-390-light.png`）
2. 横ドラッグ → 輪と芯の向きが変わった（`dex14-03a-before-drag-390-light.png` →
   `dex14-03b-after-drag-390-light.png`。記事1/記事2のラベル位置が入れ替わり、芯の向きも変わっている）
3. 点（離れかけの金の点）をタップ → `role="dialog" aria-label="主張のカード"` が覆いの上に出た
   （`dex14-04-card-over-lift-390-light.png`。quiz モードのカードが正しく出た＝離れかけの判定が効いている）
4. Esc を1回 → カードだけ閉じて覆いは残る（DOM で確認: dialog 0件・覆い1件）。もう1回 Esc → 覆いが閉じて
   分野ページに戻る（`dex14-06-after-esc2-390-light.png`。ヘッダーが見えている＝覆いがヘッダーを隠していたことの裏返しの確認）
5. ライトで、覆いの中の点と線が読める（`dex14-02-open-390-light.png`）。「戻る」ボタンでも閉じることを確認
   （DOM: クリック前 覆い1件→クリック後 0件、`dex14-07-after-back-390-light.png`）

390幅・1280幅、ライト・ダークの4枚:
`dex14-02-open-390-light.png` / `dex14-08-open-390-dark.png` /
`dex14-09-open-1280-light.png` / `dex14-10-open-1280-dark.png`
（置き場所はすべて
`/private/tmp/claude-501/-Users-tatsukinonaka-MediNode---/aafdf727-d055-43fd-87eb-23121b03f708/scratchpad/`）

DOM での追加確認: 覆いが開いているあいだ、元の紋章ボタンの class に `opacity-30` が付くこと、
アプリのヘッダー（`data-app-header`）が覆いの下（z-10 < z-20）に隠れること（見た目のスクショで確認）。

検証用 python（scratchpad に置いた。worktree 直下には置いていない）:
`.../dex14_step1.py` `.../dex14_step2.py` `.../dex14_step3.py`

## 確かめたこと

- `npx tsc --noEmit`: エラー無し
- `npx vitest run`: 1914/1915 成功。唯一の失敗は `src/lib/__tests__/admin-engagement-route.test.ts`
  （日本時間0〜9時のあいだ必ず落ちる既知の別件。今回の変更と無関係）
- `npm run build`: 成功
- `git status`: `RecallLift.tsx` の新規・`RecallPlatePage.tsx` / `RecallScreen.tsx` の変更のみ
- `git diff -- src/components/recall/RecallField.tsx`: 差分なし（無変更を確認）

## 未確認のこと

- **iOS Safari の `fixed` の効き**（覆いがスクロール位置に追従するか）は playwright では確かめられない。
  未確認（推測で「たぶん大丈夫」とは書かない）
