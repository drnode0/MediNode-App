# Recall ブラッシュアップ7件 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-09-05 の実画面調査で出た Recall の候補7件（[`brushup-2026-09-05-recall.md`](../../../brushup-2026-09-05-recall.md)）を、影響の大きい順に1件ずつ直して main に積む。

**Architecture:** 判断は `src/lib/recall/` の純関数（vitest）に置き、画面側（`src/components/recall/`）はそれを呼ぶだけ。見た目の変更は `/dev/recall-screen` を Python の playwright で撮って目で確かめる（Browser pane は 800×450 で細部が判断できない）。

**Tech Stack:** Next.js（App Router）・React・TypeScript・Tailwind（`darkMode: 'class'`）・vitest・canvas 2D・Python playwright（導入済み・chromium あり。Node 側の playwright は無い）

## Global Constraints

- 公開リポジトリ。事業数値・税務・健康・家族に関することをファイル・コミット文・コメントに書かない
- push は毎回 tatsuki さんの承認を取る。コミットは自由
- **worktree で作業する**（記憶 shared-worktree-branch-collision）。worktree では Browser pane が使えないので、画面確認は Python playwright で `http://localhost:3210/dev/recall-screen` を撮る。dev server は共有チェックアウト側で走るため、**worktree の変更を見るには共有チェックアウトに merge してから撮る**か、`npm run dev -- -p 3215` を worktree 内で別ポートで立てる（後者を推奨。起動は Bash の `run_in_background`）
- 使わない語（画面・コメント）: 振る・拾う・血肉・落ちる・定着・惑星・輪・席（席は内部語）。長いダッシュ（二重の横線）を使わない
- ダークの地は他タブと同じ紺（Node Field の緑は取り下げ済み）。ライトは紙
- 改訂の旗・一覧の紋章から球を出すこと・玄関を惑星へ戻すことは範囲外
- コミット文の末尾: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- テストの実行: `npx vitest run <file>`。全件は `npm test`（実行前 1914 件が緑）

## ファイル構成

| ファイル | 役割 | 触るタスク |
|---|---|---|
| `src/lib/recall/dex-quiz.ts` | 「確かめる」の列を進める純関数。`nextSweepSlot` の折り返し | 1 |
| `src/components/recall/RecallScreen.tsx` | 列の終わりで次の分野へ移る処理を `useEffect` に出す（stale closure を避ける） | 1 |
| `src/components/recall/RecallCard.tsx` | カードの後ろに半透明の覆いを敷く | 2 |
| `src/components/recall/RecallDex.tsx` | 一枚（Plate）の紋章を上寄せにする | 3 |
| `src/lib/recall/core-shapes.ts` | signal の幹を太く／invasion の異物の外側を抑える／regulation の乱れを大きく | 4・5・7 |
| `src/lib/recall/field-palette.ts` | ダークの離れかけの金を DOM と同じ `#F0D68A` に揃える | 6 |
| `src/lib/__tests__/recall-dex-quiz.test.ts` | 折り返しのテスト | 1 |
| `src/lib/__tests__/recall-core-shapes.test.ts` | 4・5・7 のテスト | 4・5・7 |
| `src/lib/__tests__/recall-field-palette.test.ts` | 6 のテスト | 6 |

---

### Task 0: worktree と dev server

**Files:** なし（環境）

- [ ] **Step 1: worktree を作る**

```bash
cd ~/MediNode-本体 && git worktree add .claude/worktrees/recall-brushup -b recall-brushup main && cd .claude/worktrees/recall-brushup && npm install --no-audit --no-fund 2>&1 | tail -2
```

- [ ] **Step 2: テストが緑であることを確かめる**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests  1914 passed` 前後（件数は当日の main に合わせる）。赤があれば main 由来なので触らず記録だけ残す（`src/lib/__tests__/admin-engagement-route.test.ts` は日本時間 0〜9 時に落ちる既知の不具合）

- [ ] **Step 3: worktree 用の dev server を別ポートで立てる**

Run（`run_in_background`）: `npm run dev -- -p 3215`
確認: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3215/dev/recall-screen` が 200（初回は 30〜60 秒）

- [ ] **Step 4: 撮影用のスクリプトを scratchpad に置く**

`<scratchpad>/shoot.py`（以降のタスクで `python3 shoot.py <name>` として使う）:

```python
import asyncio, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shot'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, mobile in [('pc', {'width': 1280, 'height': 820}, False), ('sp', {'width': 390, 'height': 844}, True)]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=2, is_mobile=mobile, has_touch=mobile)
            pg = await ctx.new_page()
            await pg.goto('http://localhost:3215/dev/recall-screen', wait_until='networkidle')
            for theme in ['light', 'dark']:
                await pg.evaluate(f"document.documentElement.classList.{'add' if theme == 'dark' else 'remove'}('dark')")
                await pg.wait_for_timeout(800)
                await pg.screenshot(path=f'{OUT}-{name}-{theme}.png', full_page=True)
            await ctx.close()
        await b.close()
asyncio.run(main())
```

---

### Task 1: 「離れかけを順に確かめる」を最後まで回す（候補1・大）

**Files:**
- Modify: `src/lib/recall/dex-quiz.ts:34-43`
- Modify: `src/components/recall/RecallScreen.tsx:294-318`（`onAnswer` の列の終わり）
- Test: `src/lib/__tests__/recall-dex-quiz.test.ts`

**Interfaces:**
- Produces: `nextSweepSlot(plates: PlateModel[], current: number | null): number | null` は、current より後ろに離れかけのある分野が無ければ**先頭へ折り返す**（current 自身に離れかけが残っていれば current を返す）。離れかけのある分野が1つも無いときだけ null

**なぜ:** 実測で離れかけ 46 件のうち 32 件で「今日の離れかけを確かめました」が出た。原因は2つ。`nextSweepSlot` が current より後ろしか見ないこと（末尾の分野で終わる）と、1分野1回の列が 5 件まで（`MAX_CANDIDATES`）なので 6 件以上ある分野は残ること。折り返しを入れれば、5 件ずつ回って全部なくなるまで続く。

- [ ] **Step 1: 折り返しのテストを書く**

`src/lib/__tests__/recall-dex-quiz.test.ts` の `describe('nextSweepSlot', …)` に足す（無ければ新しい describe を作る）:

```ts
describe('nextSweepSlot の折り返し', () => {
  it('末尾の分野の次は、先頭の離れかけのある分野へ戻る', () => {
    const plates = [plate(2, 3), plate(5, 0), plate(9, 1)]
    expect(nextSweepSlot(plates, 9)).toBe(2)
  })

  it('current にまだ離れかけが残っていて他に無ければ current を返す（5件ずつ同じ分野を回る）', () => {
    const plates = [plate(2, 0), plate(9, 12)]
    expect(nextSweepSlot(plates, 9)).toBe(9)
  })

  it('離れかけのある分野が1つも無ければ null', () => {
    expect(nextSweepSlot([plate(2, 0), plate(9, 0)], 9)).toBeNull()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-dex-quiz.test.ts`
Expected: FAIL（1つ目が `null` を返して落ちる）

- [ ] **Step 3: 折り返しを実装する**

`src/lib/recall/dex-quiz.ts` の `nextSweepSlot` を置き換える:

```ts
// 「離れかけを順に確かめる」で次に開く分野の席番号。離れかけ（escaping > 0）のある分野だけを
// 対象に、席番号順で current の次を返す。current が null なら先頭。
//
// 末尾まで来たら先頭へ折り返す。1分野1回の列は最大5件（srs.ts の MAX_CANDIDATES）なので、
// 6件以上ある分野は1周では終わらない。折り返せば、離れかけのある分野が1つも
// 無くなるまで回り続ける（current 自身にまだ残っていれば current を返す）。
// 折り返さない作りでは、実データで「今日の離れかけを確かめました」が途中で出た
//（2026-09-05 実測: 46件のうち32件で終了）。
//
// plates は platesOf が席番号順に返す実装だが、その前提には頼らず自分で並べ替える。
export function nextSweepSlot(plates: PlateModel[], current: number | null): number | null {
  const slots = plates
    .filter((p) => p.escaping > 0)
    .map((p) => p.slot)
    .sort((a, b) => a - b)
  if (slots.length === 0) return null
  if (current === null) return slots[0]
  const next = slots.find((s) => s > current)
  return next ?? slots[0]
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-dex-quiz.test.ts`
Expected: PASS（既存の「末尾の次は null」を主張するテストがあれば、折り返しの仕様に書き換える）

- [ ] **Step 5: 画面側の「次の分野へ」を useEffect に出す**

理由: `onAnswer` は `await data.review(...)` の後に `plates`・`startCheck` を読むが、それらは await の前のレンダーの値（stale closure）。折り返しで**同じ分野**に戻るとき、古い `plates` は答える前の離れかけ数を、古い `startCheck` は答える前の候補を返し、いま答えた主張のカードがもう一度開く。state に「この分野の列が終わった」を置き、次のレンダーの effect で新しい値を読む。

`src/components/recall/RecallScreen.tsx`:

(a) state を足す（`const [lift, setLift] = …` の直後）:

```ts
  // 「離れかけを順に確かめる」で1分野の列が終わったとき、次の分野を決めるのは次のレンダーの
  // useEffect に任せる（下の sweepFrom の effect）。onAnswer の中で決めると、await の前の
  // plates・startCheck（答える前の値）を読んでしまい、折り返しで同じ分野へ戻るときに
  // いま答えた主張のカードがもう一度開く。
  const [sweepFrom, setSweepFrom] = useState<number | null>(null)
```

(b) effect を足す（`onSweep` の定義の直後）:

```ts
  useEffect(() => {
    if (sweepFrom === null) return
    setSweepFrom(null)
    const nextSlot = nextSweepSlot(plates, sweepFrom)
    if (nextSlot === null) {
      setView({ kind: 'dex' })
      say('今日の離れかけを確かめました')
      return
    }
    openPage(nextSlot)
    startCheck(nextSlot, true)
  }, [sweepFrom, plates, openPage, startCheck, say])
```

(c) `onAnswer` の列の終わりを置き換える。現行:

```ts
            // 「離れかけを順に確かめる」の続き（手順6）。次の分野があれば移って続ける。
            const nextSlot = nextSweepSlot(plates, advanced.slot)
            if (nextSlot === null) {
              setView({ kind: 'dex' })
              say('今日の離れかけを確かめました')
              return
            }
            say(runSummary(advanced, data.nextDueOf(advanced.slot), new Date()))
            openPage(nextSlot)
            startCheck(nextSlot, true)
```

置き換え後:

```ts
            // 「離れかけを順に確かめる」の続き（手順6）。次の分野は、保存が反映された後の
            // レンダーで決める（上の sweepFrom の effect）。
            say(runSummary(advanced, data.nextDueOf(advanced.slot), new Date()))
            setSweepFrom(advanced.slot)
```

- [ ] **Step 6: 型と全テスト**

Run: `npx tsc --noEmit -p . 2>&1 | head -5 && npm test 2>&1 | tail -3`
Expected: 型エラーなし・全件 PASS

- [ ] **Step 7: 実画面で最後まで回ることを確かめる**

`<scratchpad>/sweep.py`（スマホ幅・ライト。`/dev/recall-screen` の仮データは離れかけ 46 件）:

```python
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        await pg.goto('http://localhost:3215/dev/recall-screen', wait_until='networkidle')
        await pg.get_by_role('button', name='離れかけを順に確かめる').click()
        answered = 0
        for _ in range(80):
            btn = pg.get_by_role('button', name='覚えた')
            if await btn.count() == 0:
                await pg.wait_for_timeout(1200)
                if await btn.count() == 0: break
            await btn.first.click(); answered += 1
            await pg.wait_for_timeout(1100)
        text = await pg.locator('body').inner_text()
        print('answered', answered, '| 離れかけ' in text, text[:300])
        await pg.screenshot(path='sweep-end.png', full_page=True)
        await b.close()
asyncio.run(main())
```

Run: `python3 sweep.py`
Expected: `answered 46`、終了後の一覧の「今日」の帯に「離れかけ」の件数が出ない（`today.notice` の文言になる）。`sweep-end.png` を Read で開いて確かめる

- [ ] **Step 8: コミット**

```bash
git add src/lib/recall/dex-quiz.ts src/components/recall/RecallScreen.tsx src/lib/__tests__/recall-dex-quiz.test.ts
git commit -m "fix(recall): 「離れかけを順に確かめる」を最後の1件まで回す（末尾で先頭へ折り返す）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: カードの後ろに覆いを敷く（候補2・中）

**Files:**
- Modify: `src/components/recall/RecallCard.tsx:57-60`（return の直前と最外の div）

**Interfaces:**
- Consumes: `RecallCard` の `onClose: () => void`（既存）
- Produces: カードの後ろ（z-[29]）に `role="presentation"` の覆い。押すと `onClose`

**なぜ:** カードは `fixed` の1枚で、外側は素通り。カードの上に覗いている別の行を押すと、カードを閉じずに中身だけ別の主張へ差し替わった（実測）。隠しコマンドの覆い（`RecallLift`）は既に外側タップで閉じる作りなので、それに揃える。

- [ ] **Step 1: 覆いを足す**

`src/components/recall/RecallCard.tsx` の `return (` 以降を次にする（最外を fragment にし、覆いを先に置く。カード本体の div は変えない）:

```tsx
  return (
    <>
      {/* カードの後ろの覆い。カードの外側を押したら閉じる（記録は書かない）。
          覆いが無いと、カードの上に覗いている行を押せてしまい、カードを閉じたつもりがなく
          中身だけ別の主張に差し替わる（2026-09-05 実画面で確認）。
          隠しコマンドの覆い（z-20）より上・カード（z-30）より下。 */}
      <div role="presentation" onClick={onClose}
        className="fixed inset-0 z-[29] bg-slate-900/[.12] dark:bg-black/[.35] motion-safe:animate-[recall-card-veil_.3s_ease-out]" />
      <div className="fixed left-1/2 -translate-x-1/2 bottom-[22px] z-30 …（既存のまま）
```

`recall-card-veil` の keyframes は既存の `recall-card-rise` と同じ場所（`grep -rn "recall-card-rise" src --include=*.css` で在処を確かめる）に足す:

```css
@keyframes recall-card-veil { from { opacity: 0 } to { opacity: 1 } }
```

- [ ] **Step 2: 隠しコマンドの中でも壊れないことを確かめる**

`RecallField` は `cardOpen` のとき背景タップで `onCloseCard` を呼ぶが、覆いが上に来るのでタップは覆いが受ける。どちらも `closeCard` なので挙動は同じ。`RecallLift` の Esc の譲り合い（`[role="dialog"][aria-label="主張のカード"]` の有無で判定）は覆いに影響されない。

Run: `npx tsc --noEmit -p . 2>&1 | head -3 && npm test 2>&1 | tail -3`
Expected: 緑

- [ ] **Step 3: 実画面で確かめる**

`<scratchpad>/veil.py`:

```python
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        await pg.goto('http://localhost:3215/dev/recall-screen', wait_until='networkidle')
        await pg.get_by_role('button', name='救急蘇生').first.click()
        await pg.wait_for_timeout(500)
        # 分野ページの行（RecallDot の <i aria-hidden> を含む可視のボタン）。一覧は hidden なので :visible で除く
        rows = pg.locator('button:visible:has(i[aria-hidden])')
        await rows.nth(0).click()
        await pg.wait_for_timeout(700)
        await pg.screenshot(path='veil-1-open.png')
        dlg = pg.get_by_role('dialog', name='主張のカード')
        box = await dlg.bounding_box()
        # カードの真上（覗いている行）を押す → カードが閉じ、別の主張に差し替わらない
        await pg.mouse.click(box['x'] + box['width'] / 2, box['y'] - 30)
        await pg.wait_for_timeout(500)
        print('dialog after outside tap:', await dlg.count())
        await pg.screenshot(path='veil-2-after.png')
        await b.close()
asyncio.run(main())
```

Run: `python3 veil.py`
Expected: `dialog after outside tap: 0`。`veil-1-open.png` を Read で開き、覆いが濃すぎて分野ページが読めなくなっていないこと（薄い膜程度）を見る

- [ ] **Step 4: コミット**

```bash
git add src/components/recall/RecallCard.tsx $(git ls-files -m | grep '\.css$')
git commit -m "fix(recall): カードの後ろに覆いを敷き、外側タップで閉じる

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: PC幅で紋章と点の列の縦位置を揃える（候補3・中）

**Files:**
- Modify: `src/components/recall/RecallDex.tsx:75-79`（`Plate` の button と `CoreEmblem`）

**なぜ:** 2列表示（1枚の実効幅 約270px）で和名・英名とも折り返す分野（ICU運営・医療安全・教育）は名前ブロックが4行になり、`items-center` で紋章が名前＋トレイの中央に置かれて浮く。紋章を上に寄せれば、名前が何行でも紋章は名前の先頭に揃う（標本ラベルの型）。

- [ ] **Step 1: 直す前を撮る**

Run: `python3 shoot.py before-dex`
`before-dex-pc-light.png` を Read で開き、「ICU運営・医療安全・教育」の一枚を見ておく

- [ ] **Step 2: 紋章を上寄せにする**

`src/components/recall/RecallDex.tsx` の `Plate`:

```tsx
    <button type="button" onClick={() => onOpen(plate.slot)} aria-label={plate.label}
      className="relative grid grid-cols-[72px_1fr] gap-x-3.5 gap-y-1.5 items-start border border-slate-300/70 …（以降は既存のまま）
```

（`items-center` → `items-start`）。`CoreEmblem` は:

```tsx
      {/* 紋章は名前の先頭に揃える（items-start）。和名・英名が折り返して名前ブロックが
          4行になる分野（PC幅の2列時）でも、紋章が名前＋トレイの中央に浮かない。 */}
      <CoreEmblem slot={plate.slot} kind={plate.kind} size={72} className="row-span-2 mt-0.5" />
```

- [ ] **Step 3: 撮って比べる**

Run: `python3 shoot.py after-dex`
`after-dex-pc-light.png`・`after-dex-sp-light.png` を Read で開く。
Expected: PC幅で「ICU運営・医療安全・教育」の紋章の上端が和名の上端と揃う。スマホ幅（1列）で他の分野の見え方が崩れていない（名前3行＋トレイ ≈ 紋章の高さなので差はほぼ出ない）

- [ ] **Step 4: コミット**

```bash
git add src/components/recall/RecallDex.tsx
git commit -m "fix(recall): 一覧の紋章を名前の先頭に揃える（PC幅の長い分野名で浮かない）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: signal 族の紋章に太い幹を足す（候補4・中・既知）

**Files:**
- Modify: `src/lib/recall/core-shapes.ts:365-372`（`kind === 'signal'`）
- Test: `src/lib/__tests__/recall-core-shapes.test.ts`

**Interfaces:**
- Produces: `coreLayers('signal', t)` が2層を返す。`[0]` は枝全体（既存）、`[1]` は根から出る最初の3本（`tree()` の先頭3本）を `bold: true` で重ねた層

**なぜ:** signal は7族で唯一 `bold` の線を持たず、ライトの紙の上で細く淡い（実測。`minA` を 0.25 に上げても薄め）。`tree(depth)` は根から3方向へ生やし、`out` には親→子の順で push されるので、**先頭3本が幹**。幹だけ太くすれば、枝の細さ（信号らしさ）は保てる。

- [ ] **Step 1: テストを書く**

```ts
describe('信号: 幹は太い', () => {
  it('枝の層と、幹3本の太い層の2層になる', () => {
    const layers = coreLayers('signal', 1)
    expect(layers.length).toBe(2)
    expect(layers[0].bold ?? false).toBe(false)
    expect(layers[1].bold).toBe(true)
    expect(layers[1].lines.length).toBe(3)
    // 幹は枝の層の先頭3本と同じ線
    expect(layers[1].lines).toEqual(layers[0].lines.slice(0, 3))
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts -t 幹`
Expected: FAIL（層が1つ）

- [ ] **Step 3: 実装**

`core-shapes.ts` の `if (kind === 'signal') { … }` を置き換える:

```ts
  if (kind === 'signal') {
    const fire = (t * 0.62) % 3.15
    const lines = cached(key('tree'), () => tree(density > 1.1 ? 5 : 4))
    return [
      {
        lines,
        ink: INK_COOL,
        glow: glowOn && fire < 1.9 ? { pos: (fire / 1.9) * 1.45, w: 0.11, wrap: 0 } : null,
      },
      // 幹（根から出る最初の3本）だけ太く重ねる。信号は7族で唯一 bold を持たず、
      // ライトの紙の上で細く淡かった（2026-09-05 実画面）。枝の細さは信号らしさなので変えない。
      { lines: lines.slice(0, 3), ink: INK_COOL, bold: true },
    ]
  }
```

`tree()` の push 順が「根の3本が先頭」であることは `tree` の実装（`grow` が自分を push してから子を生やす。根は `for (let i = 0; i < 3; i++)` で順に呼ぶ）から成り立つが、根の1本目の子が根の2本目より先に push される点に注意: `out` の先頭3本は「根1・根1の子・根1の子の子…」になる可能性がある。**Step 2 のテストが `slice(0,3)` で落ちたら**、`tree()` の中で根の3本を先に push するよう `grow` を「自分を push → 子は後でまとめて」に変えず、代わりに `tree()` の戻り値の**根の線を判別する**: 根の線は始点が `[0, -0.86, 0]` なので、

```ts
      { lines: lines.filter((l) => l[0][0] === 0 && l[0][1] === -0.86 && l[0][2] === 0), ink: INK_COOL, bold: true },
```

とし、テストの最後の行を `expect(layers[1].lines.every((l) => l[0][1] === -0.86)).toBe(true)` に替える。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts`
Expected: PASS（既存の signal のテストが「層は1つ」を主張していたら、2つに直す）

- [ ] **Step 5: 実画面で見る**

Run: `python3 shoot.py after-signal`
`after-signal-pc-light.png` の「中枢神経」の紋章を Read で見る。幹が見え、他の族（呼吸・循環）と並べて薄すぎない。ダーク（`after-signal-pc-dark.png`）で太すぎない

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/core-shapes.ts src/lib/__tests__/recall-core-shapes.test.ts
git commit -m "fix(recall): 信号の紋章に太い幹を足す（ライトで細く淡かった）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 感染症の異物が円い枠を突き破らないようにする（候補5・小）

**Files:**
- Modify: `src/lib/recall/core-shapes.ts:273-286`（`foreignBody`）
- Test: `src/lib/__tests__/recall-core-shapes.test.ts`

**Interfaces:**
- Produces: `export const FOREIGN_MAX_R = 1.26`。`foreignBody` の点の半径はこれを超えない

**なぜ:** 異物は `head = depth + 0.78`（近づく段で最大 2.73）・破れた後 1.74 の半径から始まる。紋章は `CR = size × 0.36` で描き、輪郭の円は `size × 0.47`（= CR × 1.31）なので、半径 1.31 を超える線は円の外に出る（実測: 72px でも突き抜けが見える）。「異物は球の外から来る」の演出は 1.26 から 0.92 へ近づくだけでも伝わる。

- [ ] **Step 1: テストを書く**

```ts
describe('侵入: 異物は紋章の円の中に収まる', () => {
  it('どの時刻でも異物の点の半径は FOREIGN_MAX_R を超えない', () => {
    for (let s = 0; s < 1; s += 0.02) {
      const layers = coreLayers('invasion', s * INVASION_CYCLE_SEC)
      const body = layers[1].lines[0]
      for (const p of body) {
        expect(Math.hypot(p[0], p[1], p[2])).toBeLessThanOrEqual(FOREIGN_MAX_R + 1e-9)
      }
    }
  })
})
```

`import` に `FOREIGN_MAX_R` を足す。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts -t 円の中`
Expected: FAIL（半径 2.7 前後の点がある）

- [ ] **Step 3: 実装**

`core-shapes.ts`。定数を `WEAVE_R` の直後に足す:

```ts
// 異物の外側の上限。紋章の輪郭の円は芯の半径の 1.31 倍（CoreEmblem: size×0.47 / size×0.36）なので、
// それより内側に収める。ここを超えると異物が円い枠を突き破って見える（2026-09-05 実画面）。
export const FOREIGN_MAX_R = 1.26
```

`foreignBody` の `head` と `depth` の行を置き換える:

```ts
  const depth = Math.min(FOREIGN_MAX_R, s < INVASION_TOUCH
    ? 1.95 - (1.95 - WEAVE_R) * Math.pow(s / INVASION_TOUCH, 1.6)
    : s < INVASION_BREAK
      ? WEAVE_R * (1 - amp * dentCurve(s))
      : WEAVE_R * (1 - amp) - 1.4 * Math.min(1, ((s - INVASION_BREAK) / (1 - INVASION_BREAK)) * 2.2))
  const broke = s < INVASION_BREAK ? 0 : Math.min(1, ((s - INVASION_BREAK) / (1 - INVASION_BREAK)) * 2)
  const head = Math.min(FOREIGN_MAX_R, s < INVASION_BREAK ? depth + 0.78 : 1.74)
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts`
Expected: PASS（既存の「物理の順番」のテストは近づく向きしか見ていないので影響なし。落ちたら理由を読んで、上限に当たる区間の主張だけ緩める）

- [ ] **Step 5: 実画面で見る**

Run: `python3 shoot.py after-invasion`
「感染症」の紋章（ライト・ダーク）を Read で見る。金の線が円の中に収まり、近づく→凹む→破れるの動きが残っている（30fps の紋章なので、同じスクリプトを 2 回撮れば別の位相が見える）

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/core-shapes.ts src/lib/__tests__/recall-core-shapes.test.ts
git commit -m "fix(recall): 侵入の異物を紋章の円の中に収める

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: ダークの離れかけの金を1色にする（候補6・小・既知）

**Files:**
- Modify: `src/lib/recall/field-palette.ts:45`（`DARK_PALETTE.inks[INK_HALO]`）
- Test: `src/lib/__tests__/recall-field-palette.test.ts`

**Interfaces:**
- Produces: `export const GOLD_DARK = '#F0D68A'`、`export const GOLD_LIGHT = '#A86B0C'`（field-palette.ts）。DOM 側の `text-[#F0D68A]` / `text-[#A86B0C]`（RecallDot・RecallDex・RecallPlatePage）と同じ値

**なぜ:** ダークで点・ボタン（DOM `#F0D68A`）と紋章の中の金（canvas `INK_HALO` `#F6E7B8`）が2色に分かれている（実測: 紋章内の最暖色 (243,234,219) に対し点は (240,214,138)）。ライトは両方 `#A86B0C` で揃っている。`INK_HALO` は芯の線の定義のキーなので値は変えず、ダークの組での引き直し先だけ DOM に揃える。

- [ ] **Step 1: テストを書く**

```ts
import { DARK_PALETTE, LIGHT_PALETTE, GOLD_DARK, GOLD_LIGHT, inkOf } from '@/lib/recall/field-palette'

describe('離れかけの金は DOM と canvas で同じ色', () => {
  it('ダークは #F0D68A（RecallDot・RecallDex・RecallPlatePage の text-[#F0D68A] と同じ）', () => {
    expect(GOLD_DARK).toBe('#F0D68A')
    expect(inkOf(DARK_PALETTE, INK_HALO)).toBe(GOLD_DARK)
  })
  it('ライトは #A86B0C（text-[#A86B0C] と同じ）', () => {
    expect(GOLD_LIGHT).toBe('#A86B0C')
    expect(inkOf(LIGHT_PALETTE, INK_HALO)).toBe(GOLD_LIGHT)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-palette.test.ts`
Expected: FAIL（`GOLD_DARK` が無い）

- [ ] **Step 3: 実装**

`field-palette.ts`。`FieldPalette` 型の前に:

```ts
// 離れかけの金。DOM 側（RecallDot・RecallDex・RecallPlatePage の text-[#…]）と canvas 側
//（芯の INK_HALO の引き直し先）を同じ値にする。Tailwind の class は文字列を走査して作られるので
// ここから差し込めない。DOM 側を変えるときはこの2つも一緒に変える（テストで固定）。
export const GOLD_DARK = '#F0D68A'
export const GOLD_LIGHT = '#A86B0C'
```

`DARK_PALETTE.inks` の `[INK_HALO]: INK_HALO,` → `[INK_HALO]: GOLD_DARK,`
`LIGHT_PALETTE.inks` の `[INK_HALO]: '#A86B0C',` → `[INK_HALO]: GOLD_LIGHT,`（コメントは残す）

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-palette.test.ts src/lib/__tests__/recall-field-render.test.ts src/lib/__tests__/recall-field-layout.test.ts`
Expected: PASS（コントラスト比 > 4 のテストは `#F0D68A` on `#0B1524` で満たす）

- [ ] **Step 5: 実画面で見る**

Run: `python3 shoot.py after-gold`
`after-gold-pc-dark.png` で、多臓器障害（regulation。錘が金）の紋章の金と、その横の離れかけの点の金が同じ色に見える

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/field-palette.ts src/lib/__tests__/recall-field-palette.test.ts
git commit -m "fix(recall): ダークの離れかけの金を DOM と canvas で1色にする

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 多臓器障害の紋章が止まって見える件を測ってから直す（候補7・小）

**Files:**
- Modify: `src/lib/recall/core-shapes.ts:436-452`（`kind === 'regulation'`。**測って必要なときだけ**）
- Test: `src/lib/__tests__/recall-core-shapes.test.ts`

**Interfaces:**
- Produces（直す場合のみ）: `export const REGULATION_KICK = { amp: 0.42, decay: 0.6 }`、`export const REGULATION_NUDGE = { amp: 0.16, decay: 0.8 }`

**なぜ・注意:** この候補は**静止画1枚から**「ほぼ静止して見える」と判定された（調査担当の報告）。コード上は3つの輪が 0.3／0.44／0.62 rad/s で回り続けているので、動画で見れば止まっていない可能性が高い。先に時間差の3枚で動きを測り、輪が回って見えるなら**直さない**（`brushup-2026-09-05-recall.md` の7に「測定の結果、動いている。見送り」と書く）。乱れ（kick）が 1 秒足らずで消えて周期の残り 6 秒が回転だけ、という点を直したいなら下の Step 3 以降を行う。

- [ ] **Step 1: 2 秒おきに 3 枚撮り、多臓器障害の紋章の画素差を測る**

`<scratchpad>/reg.py`:

```python
import asyncio
from playwright.async_api import async_playwright
from PIL import Image, ImageChops
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 820}, device_scale_factor=2)
        pg = await ctx.new_page()
        await pg.goto('http://localhost:3215/dev/recall-screen', wait_until='networkidle')
        el = pg.get_by_role('button', name='多臓器障害').locator('canvas')
        for i in range(3):
            await el.screenshot(path=f'reg-{i}.png')
            await pg.wait_for_timeout(2000)
        await b.close()
    a, b2, c = [Image.open(f'reg-{i}.png').convert('L') for i in range(3)]
    for x, y, n in [(a, b2, '0-1'), (b2, c, '1-2')]:
        d = ImageChops.difference(x, y)
        px = sum(1 for v in d.getdata() if v > 40)
        print(n, 'changed px', px, 'of', d.size[0] * d.size[1])
asyncio.run(main())
```

Run: `python3 reg.py`（PIL が無ければ `pip3 install pillow`）
判定: 変わった画素が全体の 3% 以上なら「動いている」。3 枚を Read で開いて輪の傾きが変わっていることも目で見る

- [ ] **Step 2: 動いていれば見送りを記録して Task 8 へ**

`brushup-2026-09-05-recall.md` の 7 に「2026-09-XX 測定: 3枚で画素差 n%・輪は回っている。静止画からの判定だったので見送り」と書く。**このタスクはここで終わり**

- [ ] **Step 3（直す場合のみ）: テストを書く**

```ts
describe('調節: 乱れが 1.5 秒後にも残る', () => {
  it('周期の 1.5 秒目で錘のずれが 0.03 以上', () => {
    const at = (t: number) => {
      const p = coreLayers('regulation', t)[1].lines[0][0]
      const base = coreLayers('regulation', 7.39)[1].lines[0][0]
      return Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2])
    }
    expect(at(1.5)).toBeGreaterThan(0.03)
    expect(at(0.1)).toBeGreaterThan(at(6.0))
  })
})
```

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts -t "1.5 秒"`
Expected: FAIL（現行は 0.055 × e^-3.15 ≈ 0.002）

- [ ] **Step 4（直す場合のみ）: 実装**

`core-shapes.ts`。`WEAVE_R` の近くに定数:

```ts
// 調節の乱れ。amp は振れ幅、decay は 1 秒あたりの減衰。周期（7.4 秒）の前半で乱れが見えるように、
// 2026-09-05 に kick の decay を 1.5→0.6、錘の振れ幅を 0.055→0.16・decay を 2.1→0.8 に変えた
//（それ以前は 1 秒足らずで収まり、残りの 6 秒は輪が回るだけだった）。
export const REGULATION_KICK = { amp: 0.42, decay: 0.6 }
export const REGULATION_NUDGE = { amp: 0.16, decay: 0.8 }
```

`kind === 'regulation'` の中の2行:

```ts
    const kick = REGULATION_KICK.amp * Math.exp(-beat * REGULATION_KICK.decay) * Math.sin(beat * 7.4)
    …
    const nudge = REGULATION_NUDGE.amp * Math.exp(-beat * REGULATION_NUDGE.decay) * Math.sin(beat * 9.2)
```

Run: `npx vitest run src/lib/__tests__/recall-core-shapes.test.ts`
Expected: PASS（既存「周期の頭で乱れ、時間が経つと収まる」もそのまま通る）

- [ ] **Step 5（直す場合のみ）: 実画面で見てコミット**

`python3 reg.py` をもう一度。錘が輪の外へ飛び出していない（振れ幅 0.16 は輪の半径 1 より十分小さい）。

```bash
git add src/lib/recall/core-shapes.ts src/lib/__tests__/recall-core-shapes.test.ts
git commit -m "fix(recall): 調節の紋章の乱れを周期の前半まで見えるようにする

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 仕上げ

- [ ] **Step 1: 全テスト・型・本番ビルド**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit -p . 2>&1 | head -3 && npm run build 2>&1 | tail -5`
Expected: 全件 PASS・型エラーなし・ビルド成功

- [ ] **Step 2: 4通りを撮って最終確認**

Run: `python3 shoot.py final`
4枚を Read で開き、Task 3〜7 の見た目が揃っていることを見る（特にライトの中枢神経・感染症・多臓器障害、ダークの金）

- [ ] **Step 3: `brushup-2026-09-05-recall.md` に `済 2026-09-XX` を付ける**

各候補の行頭に `済 <日付>` を足す（7件とも）。このファイルは公開リポの直下に untracked で置かれているので、コミットに含めない

- [ ] **Step 4: main へ merge（push はしない）**

```bash
cd ~/MediNode-本体 && git merge --no-ff recall-brushup -m "merge: Recall ブラッシュアップ7件（2026-09-05 実画面調査）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

push は tatsuki さんに「push してよいですか」と1行で聞く（承認後 `git push origin main`。本番は Vercel が main を自動デプロイするが、**マージ＝デプロイではない**ので `vercel ls` か Vercel の画面で Ready を確かめる）

- [ ] **Step 5: worktree を片づける**

```bash
cd ~/MediNode-本体 && git worktree remove .claude/worktrees/recall-brushup && git branch -d recall-brushup
```
