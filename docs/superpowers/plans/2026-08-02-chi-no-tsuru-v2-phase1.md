# 知の蔓 v2 フェーズ1（土台）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知の蔓をオーナーだけに閉じたうえで、高さの定数と画面の言葉を v2 の規則に合わせる。

**Architecture:** 判定・計算・文言をすべて純関数に置き、vitest で守る。UIコンポーネントは純関数を呼ぶだけにする。既存の `feature-access.ts`（マルチ部署検索の先行体験）とは**意図的に分離**した新しいアクセス判定を作る。

**Tech Stack:** Next.js / TypeScript / vitest（`npm test` = `vitest run`）。コンポーネントテストの基盤は無いので、**テストしたいものは純関数に切り出す**。

**正典:** `docs/superpowers/specs/2026-08-02-chi-no-tsuru-v2-design.md`

## Global Constraints

- **文言の六つの禁（spec §14）**：説明しない／ポーズを取らない（読点で溜めない）／語りかけない（二人称を使わない）／褒めない・励まさない／数えるものを増やさない／感嘆符を使わない
- **蔓の中の言葉は常体。** 操作の言葉（ボタン・設定・閉じる）だけ敬体のまま
- **数字**：測るもの（高さ・寸法・葉の総数）は算用数字、出来事は漢数字（`kanjiNumber` / `kanjiDate`）
- **検証ページとspecの散文はUI文言ではない。実装時に流用しない**
- **色褪せ・未読・連続日数を数えてUIに出すことは永久禁止**（`vine-leaves.ts` 冒頭の既存の禁を継承）
- **`COMPOUND_START_LEAVES × COMPOUND_RATE === 1` を壊さない**（複利の境界が滑らかであるための不変条件）
- コメントは既存ファイルの密度に合わせる（なぜそうしたかを書く。何をしているかは書かない）

---

### Task 1: 蔓専用のアクセス判定（純関数）

現状 `isTowerEnabled()` は `settings.earlyAccess` を見ており、これは `resolveEarlyAccess()` 由来。`resolveEarlyAccess` は **`MULTI_DEPARTMENT_GA=true` で全員 true を返す**ため、マルチ部署検索をGAした瞬間に蔓も全員へ公開されてしまう。分離する。

**Files:**
- Create: `src/lib/vine-access.ts`
- Test: `src/lib/__tests__/vine-access.test.ts`

**Interfaces:**
- Consumes: なし（env のみ）
- Produces: `emailInVineList(email: string | null | undefined): boolean` / `resolveVineAccess(input: { email?: string | null }): boolean`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/vine-access.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { emailInVineList, resolveVineAccess } from '../vine-access'

const SAVED = { vine: process.env.VINE_EMAILS, ga: process.env.MULTI_DEPARTMENT_GA }

beforeEach(() => {
  delete process.env.VINE_EMAILS
  delete process.env.MULTI_DEPARTMENT_GA
})
afterEach(() => {
  if (SAVED.vine === undefined) delete process.env.VINE_EMAILS
  else process.env.VINE_EMAILS = SAVED.vine
  if (SAVED.ga === undefined) delete process.env.MULTI_DEPARTMENT_GA
  else process.env.MULTI_DEPARTMENT_GA = SAVED.ga
})

describe('emailInVineList', () => {
  it('VINE_EMAILS 未設定なら誰も通さない', () => {
    expect(emailInVineList('a@example.com')).toBe(false)
  })
  it('大文字小文字と前後の空白を無視して一致させる', () => {
    process.env.VINE_EMAILS = ' A@Example.com , b@example.com '
    expect(emailInVineList('a@example.COM')).toBe(true)
    expect(emailInVineList('b@example.com')).toBe(true)
    expect(emailInVineList('c@example.com')).toBe(false)
  })
  it('メールが無ければ false', () => {
    process.env.VINE_EMAILS = 'a@example.com'
    expect(emailInVineList(null)).toBe(false)
    expect(emailInVineList(undefined)).toBe(false)
  })
})

describe('resolveVineAccess', () => {
  it('リストにあれば true', () => {
    process.env.VINE_EMAILS = 'a@example.com'
    expect(resolveVineAccess({ email: 'a@example.com' })).toBe(true)
  })
  // これが分離の核。マルチ部署のGAスイッチに引きずられないことを固定する。
  it('MULTI_DEPARTMENT_GA=true でも、リストに無ければ false', () => {
    process.env.MULTI_DEPARTMENT_GA = 'true'
    expect(resolveVineAccess({ email: 'a@example.com' })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npm test -- src/lib/__tests__/vine-access.test.ts
```

Expected: FAIL（`Failed to resolve import "../vine-access"`）

- [ ] **Step 3: 実装する**

Create `src/lib/vine-access.ts`:

```ts
// 知の蔓の開放判定。マルチ部署検索の先行体験（feature-access.ts）とは意図的に分離する。
// 共用のままだと MULTI_DEPARTMENT_GA=true にした瞬間に蔓まで全員へ公開されるため
// （resolveEarlyAccess が GA で無条件 true を返す）。開放先は蔓とマルチ部署で別に決める。
// 判定の正はサーバー。クライアントは表示制御のためにミラーを持つだけ。
export function emailInVineList(email: string | null | undefined): boolean {
  const list = (process.env.VINE_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

export function resolveVineAccess(input: { email?: string | null }): boolean {
  return emailInVineList(input.email)
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- src/lib/__tests__/vine-access.test.ts
```

Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/vine-access.ts src/lib/__tests__/vine-access.test.ts
git commit -m "知の蔓: 蔓専用のアクセス判定を追加（マルチ部署のGAから分離）"
```

---

### Task 2: 配線（サーバー → 同期 → フラグ）

**Files:**
- Modify: `src/app/api/premium/status/route.ts:48` 付近と、`earlyAccess,` を含む3箇所（`:59`, `:74`, `:91`）
- Modify: `src/lib/settings.ts:42` 付近
- Modify: `src/components/auth/PremiumSync.tsx:96-97`
- Modify: `src/lib/tower-flags.ts`

**Interfaces:**
- Consumes: `resolveVineAccess` (Task 1)
- Produces: `settings.vineAccess?: boolean` / `isTowerEnabled(): boolean`（シグネチャ不変・参照先だけ変わる）

- [ ] **Step 1: サーバーが `vineAccess` を返すようにする**

`src/app/api/premium/status/route.ts`：

1. import に追加：

```ts
import { resolveVineAccess } from '@/lib/vine-access'
```

2. `const earlyAccess = resolveEarlyAccess({ ... })`（48行目）の直後に追加：

```ts
  // 蔓は別判定（マルチ部署のGAに引きずられないため）
  const vineAccess = resolveVineAccess({ email: user.email })
```

3. `earlyAccess,` と書いてある**3箇所すべて**（`:59`, `:74`, `:91`）の直後に `vineAccess,` を追加する。

- [ ] **Step 2: 設定の型に足す**

`src/lib/settings.ts`、`earlyAccess?: boolean`（42行目）の直後：

```ts
  // 知の蔓の開放フラグのミラー（表示制御のみ・判定の正はサーバー）。earlyAccess とは別物。
  vineAccess?: boolean
```

- [ ] **Step 3: 同期を1回の保存にまとめる**

`src/components/auth/PremiumSync.tsx` の94〜99行目のブロックを置き換える。

⚠️ **注意が2つある。**
1. `earlyAccess` と `vineAccess` を別々の `if` で `saveSettings` すると、2回目が `current`（古い値）を書き戻して1回目を消す。**1つのオブジェクトにまとめて1回だけ保存する。**
2. 既存ブロックは保存後に `window.location.reload()` と `return` をしている。**この2行を落とさない**（UI反映のための軽いリロードで、落とすとフラグが変わっても画面が古いまま残る）。

Before（コメント2行を含む94〜99行目）:

```ts
        // 先行体験（マルチ部署串刺し検索）フラグを反映。active/非activeを問わず同期する
        // （フリー会員も対象になりうるため）。変化時のみ保存し、UI 反映のため軽くリロード。
        if (typeof data.earlyAccess === 'boolean' && (current.earlyAccess ?? false) !== data.earlyAccess) {
          saveSettings({ ...current, earlyAccess: data.earlyAccess })
          window.location.reload()
          return
        }
```

After:

```ts
        // 先行体験（マルチ部署串刺し検索）と知の蔓のフラグを反映。active/非activeを問わず
        // 同期する（フリー会員も対象になりうるため）。変化時のみ保存し、UI 反映のため軽くリロード。
        // 2つは別判定だが保存は1回にまとめる——別々に saveSettings すると、後の保存が
        // 古い current を書き戻して前の変更を消すため。
        const flagPatch: Partial<typeof current> = {}
        if (typeof data.earlyAccess === 'boolean' && (current.earlyAccess ?? false) !== data.earlyAccess) {
          flagPatch.earlyAccess = data.earlyAccess
        }
        if (typeof data.vineAccess === 'boolean' && (current.vineAccess ?? false) !== data.vineAccess) {
          flagPatch.vineAccess = data.vineAccess
        }
        if (Object.keys(flagPatch).length > 0) {
          saveSettings({ ...current, ...flagPatch })
          window.location.reload()
          return
        }
```

- [ ] **Step 4: フラグの参照先を差し替える**

`src/lib/tower-flags.ts` を丸ごと置き換える：

```ts
// 知の蔓の開放判定（単一チョークポイント）。当面はオーナーのみ。
// 参照先は settings.vineAccess（/api/premium/status → PremiumSync 経由のミラー）。
// earlyAccess（マルチ部署検索の先行体験）とは分離した——共用のままだと
// MULTI_DEPARTMENT_GA=true にした瞬間に蔓も全員へ公開されるため。
// 全体公開するときはここを変えるだけ。
import { getSettings } from './settings'

export function isTowerEnabled(): boolean {
  try {
    return getSettings()?.vineAccess === true
  } catch {
    return false
  }
}
```

- [ ] **Step 5: 型検査と既存テストが通ることを確認**

```bash
npx tsc --noEmit && npm test
```

Expected: 型エラーなし。既存テストは全て PASS。

- [ ] **Step 6: コミット**

```bash
git add src/app/api/premium/status/route.ts src/lib/settings.ts src/components/auth/PremiumSync.tsx src/lib/tower-flags.ts
git commit -m "知の蔓: 開放判定を earlyAccess から vineAccess へ分離して配線"
```

- [ ] **Step 7: 本番の env を設定する（オーナー作業）**

Vercel の環境変数に `VINE_EMAILS` を追加し、オーナーのメール1件だけを入れる。

https://vercel.com/dashboard → プロジェクト → Settings → Environment Variables

**設定するまで誰にも蔓が出ない**（`VINE_EMAILS` 未設定 = 全員 false）。これは意図した既定値。

---

### Task 3: 高さの定数を v2 にする

**Files:**
- Modify: `src/lib/vine-ladder.ts:5-7`
- Modify: `src/lib/__tests__/vine-ladder.test.ts:8-25`
- Modify: `docs/superpowers/specs/assets/2026-08-02-vine-rules.html`

**Interfaces:**
- Consumes: なし
- Produces: `MM_PER_LEAF = 2` / `COMPOUND_START_LEAVES = 200` / `COMPOUND_RATE = 0.005`（`heightMmFromLeaves` 等のシグネチャは不変）

- [ ] **Step 1: ゴールデンテストを新しい値に書き換える（まだ落ちる状態にする）**

`src/lib/__tests__/vine-ladder.test.ts` の8〜25行目（最初の `describe` ブロック）を置き換える：

```ts
describe('ゴールデン定数（GA後は変更不可。落ちたら定数を疑え、テストを直すな）', () => {
  it('葉1枚=2mm・複利開始200枚・r=0.5%', () => {
    expect(MM_PER_LEAF).toBe(2)
    expect(COMPOUND_START_LEAVES).toBe(200)
    expect(COMPOUND_RATE).toBe(0.005)
  })
  // 複利帯の1枚あたりの伸びは (START×MM_PER_LEAF)×RATE。これが MM_PER_LEAF と
  // 等しくなる条件が START×RATE=1。崩すと複利開始と同時に減速する。
  it('不変条件: 複利開始枚数 × 率 = 1（境界が滑らかにつながる条件）', () => {
    expect(COMPOUND_START_LEAVES * COMPOUND_RATE).toBe(1)
  })
  it('実寸帯: 葉0=0mm・葉3=6mm・葉200=400mm', () => {
    expect(heightMmFromLeaves(0)).toBe(0)
    expect(heightMmFromLeaves(3)).toBe(6)
    expect(heightMmFromLeaves(200)).toBe(400)
  })
  it('複利帯: 葉201=402mm・富士山(3776m)は葉2036枚で越える', () => {
    expect(heightMmFromLeaves(201)).toBeCloseTo(402, 6)
    expect(leavesForHeightMm(3_776_000)).toBe(2036)
  })
  it('境界の伸びが2mmのまま連続する', () => {
    expect(heightMmFromLeaves(201) - heightMmFromLeaves(200)).toBeCloseTo(2, 6)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npm test -- src/lib/__tests__/vine-ladder.test.ts
```

Expected: FAIL（`expected 125 to be 200` 他）

- [ ] **Step 3: 定数を変える**

`src/lib/vine-ladder.ts` の5〜7行目を置き換える：

```ts
export const MM_PER_LEAF = 2
export const COMPOUND_START_LEAVES = 200
export const COMPOUND_RATE = 0.005
```

さらに、その上のコメント（3〜4行目）に不変条件を書き足す：

```ts
// ⚠️ この3定数は独立ではない。COMPOUND_START_LEAVES × COMPOUND_RATE = 1 が
//    成り立つときだけ複利の境界で「1枚=2mm」が途切れない。率だけ下げると
//    複利開始と同時に減速する（率0.0034にすると2mm→0.85mmに落ち、戻るのは葉379枚）。
//    変えるときは開始枚数を選び、率はその逆数にする。
```

そして2行目の「ネコ（葉125枚=25cm）から先は複利」を実態に合わせる：

```ts
// 知の蔓の高さ関数。ルールは一文——「葉が1枚ひらくと、蔓が2mm伸びる」。
// 一升瓶のすぐ上（葉200枚=40cm）から先は複利（1枚ごとに+0.5%）。「学びは複利」を機構で語る。
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- src/lib/__tests__/vine-ladder.test.ts
```

Expected: PASS。`単調増加`・`leavesForHeightMm(250)=125`・`LADDER[6]={mm:250,label:'ネコ'}` の既存テストも通る（線形帯は不変・ラダー表は表示専用なので変わらない）。

- [ ] **Step 5: 検証ページの定数を合わせる**

`docs/superpowers/specs/assets/2026-08-02-vine-rules.html` の定数行を書き換える：

Before:

```js
  const MM_PER_LEAF = 2, COMPOUND_START = 125, COMPOUND_RATE = 0.008
```

After:

```js
  const MM_PER_LEAF = 2, COMPOUND_START = 200, COMPOUND_RATE = 0.005
```

同ファイル内の説明文も実態に合わせる：

- `ネコ（葉125枚＝25cm）から先は1枚ごとに +0.8% の複利になる。` → `一升瓶のすぐ上（葉200枚＝40cm）から先は1枚ごとに +0.5% の複利になる。`
- `だから同じ1枚でも、葉200枚のときは4mm、500枚のときは3.9cm、1000枚のときは2.1m伸びる。` → `だから同じ1枚でも、葉500枚のときは8.9mm、1000枚のときは10.8cm、1500枚のときは1.3m伸びる。`（新定数で検算済み）
- 末尾の `verdict` の2つの数字：`葉95枚＝知識およそ32件` は据え置き（画面幅由来なので定数と無関係）。`葉1333枚＝知識およそ444件で、富士山に届いて` → `葉2036枚＝知識およそ679件で、富士山に届いて`

- [ ] **Step 6: 検証ページの数字が合っているか目視**

```bash
open http://localhost:8791/2026-08-02-vine-rules.html
```

（サーバーが止まっていれば `.claude/launch.json` の `tsuru-proto` で起動）

スケール表の「1333枚」行が「2036枚」に、高さが新しい値になっていることを確認する。

- [ ] **Step 7: コミット**

```bash
git add src/lib/vine-ladder.ts src/lib/__tests__/vine-ladder.test.ts docs/superpowers/specs/assets/2026-08-02-vine-rules.html
git commit -m "知の蔓: 複利開始を200枚・率を0.5%へ（境界の連続性を不変条件テストで固定）"
```

---

### Task 4: 画面の言葉を純関数にして、六つの禁をテストで守る

コンポーネントテストの基盤が無いので、**文言を純関数に切り出してテスト対象にする**。以後この蔓に文言を足すときは、必ずこのファイルに書いてテストを通す。

**Files:**
- Create: `src/lib/vine-copy.ts`
- Test: `src/lib/__tests__/vine-copy.test.ts`
- Modify: `src/components/vine/VineScreen.tsx:111` と `:134`

**Interfaces:**
- Consumes: なし
- Produces: `crossedLine(label: string): string` / `grewLine(kanjiCount: string): string` / `weekLine(newLeaves: number, total: number): string` / `ALL_VINE_COPY: string[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/vine-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { crossedLine, grewLine, weekLine, ALL_VINE_COPY } from '../vine-copy'

describe('文言', () => {
  it('越えたときは常体で、溜めの読点を置かない', () => {
    expect(crossedLine('ネコ')).toBe('ネコを越えた')
  })
  it('ふえたときは出来事なので漢数字で受ける', () => {
    expect(grewLine('三')).toBe('葉が三枚ふえた')
  })
  it('測るものは算用数字。中黒でなく空きで区切る', () => {
    expect(weekLine(3, 274)).toBe('今週 3枚　ぜんぶで 274枚')
  })
  it('今週ゼロなら今週の分を黙る（催促にしない）', () => {
    expect(weekLine(0, 274)).toBe('ぜんぶで 274枚')
  })
})

// spec §14 の六つの禁を機械で守る。新しい文言は必ず ALL_VINE_COPY に載せる。
describe('六つの禁', () => {
  it('敬体を使わない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/です|ます|ました|ましょう|ください/)
  })
  it('溜めの読点を置かない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/、/)
  })
  it('感嘆符を使わない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/[!！]/)
  })
  it('二人称で語りかけない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/あなた|きみ|君/)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npm test -- src/lib/__tests__/vine-copy.test.ts
```

Expected: FAIL（`Failed to resolve import "../vine-copy"`）

- [ ] **Step 3: 実装する**

Create `src/lib/vine-copy.ts`:

```ts
// 知の蔓の画面に出す言葉。ここに集めてテストで守る（spec §14「画面に出す言葉」）。
// 蔓は絵であって案内役ではない。説明を始めた瞬間に世界が壊れる。
// 中は常体——敬体が混じると「アプリが喋っている」音になる。
// 操作の言葉（ボタン・設定・閉じる）はアプリの領分なのでここには入れない。
// 数字は、測るもの（高さ・葉の総数）が算用数字、出来事が漢数字。

export function crossedLine(label: string): string {
  return `${label}を越えた`
}

export function grewLine(kanjiCount: string): string {
  return `葉が${kanjiCount}枚ふえた`
}

// 今週ゼロのときは今週の分を黙る。「今週 まだ」は止まっている人への催促になる。
export function weekLine(newLeaves: number, total: number): string {
  const all = `ぜんぶで ${total}枚`
  return newLeaves > 0 ? `今週 ${newLeaves}枚　${all}` : all
}

// 六つの禁をテストで走査するための一覧。文言を足したらここにも足す。
export const ALL_VINE_COPY: string[] = [
  crossedLine('ネコ'),
  grewLine('三'),
  weekLine(3, 274),
  weekLine(0, 274),
]
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- src/lib/__tests__/vine-copy.test.ts
```

Expected: PASS（8 tests）

- [ ] **Step 5: VineScreen を純関数に差し替える**

`src/components/vine/VineScreen.tsx` の import に追加：

```ts
import { crossedLine, grewLine, weekLine } from '@/lib/vine-copy'
```

111行目を置き換える。

Before:

```tsx
            <div className="mt-0.5 text-[11px] text-[#8b8272]">今週 葉が {newLeaves > 0 ? `${newLeaves}枚` : 'まだ'}・ぜんぶで {to}枚</div>
```

After:

```tsx
            <div className="mt-0.5 text-[11px] text-[#8b8272]">{weekLine(newLeaves, to)}</div>
```

134行目を置き換える。

Before:

```tsx
              {crossed ? `${crossed.label}を、越えました` : `葉が、${kanjiNumber(Math.min(newLeaves, 99))}枚ふえました`}
```

After:

```tsx
              {crossed ? crossedLine(crossed.label) : grewLine(kanjiNumber(Math.min(newLeaves, 99)))}
```

- [ ] **Step 6: 直し漏れが無いか走査する**

```bash
grep -rn "ました\|ましょう\|を、越え\|が、" src/components/vine/ src/components/tower/
```

Expected: 何も出ない。出たら §14 の規則で直し、`vine-copy.ts` へ移してテストに載せる。

- [ ] **Step 7: 型検査と全テスト**

```bash
npx tsc --noEmit && npm test
```

Expected: 型エラーなし・全 PASS。

- [ ] **Step 8: コミット**

```bash
git add src/lib/vine-copy.ts src/lib/__tests__/vine-copy.test.ts src/components/vine/VineScreen.tsx
git commit -m "知の蔓: 画面の言葉を純関数に集約し、六つの禁をテストで守る"
```

---

## このあとの計画（別ファイルで書く）

specは独立した subsystem を複数含むので、フェーズを分けた。各フェーズ単体で動く。

| # | 内容 | spec |
|---|---|---|
| **1（この計画）** | 誰に出すか・高さの定数・画面の言葉 | §6, §14, §14-2 |
| 2 | スクロール構造（`vine-scroll.ts` 新設・`VineScene` 書き換え・越えた印＝目次・仮想化） | §3, §4, §5, §11 |
| 3 | 地下茎（`splitByJoin` / `joinedAt` / 地下描画 / 持ち込みゼロの分岐 / 地下が尽きる節目） | §7 |
| 4 | 葉の生え方（`resolved` / `attempt` / 読み返しの濃度） | §9 |
| 5 | 時間の点景（`sceneryMarks` / 空と住人 / 記録として残す） | §7 |
| — | 雲の先 | §8（数年先・器だけ） |

**フェーズ2以降の前提**：フェーズ1の `VINE_EMAILS` が設定済みであること（未設定なら誰にも見えないので、実機確認ができない）。
