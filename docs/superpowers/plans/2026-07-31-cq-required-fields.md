# 臨床疑問フォーム 必須化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリ内の臨床疑問投稿で職種・経験年数を必須にし、背景・状況を「空なら一度だけ確認する」ソフト必須にする。あわせて受付DBの職種列2本化を「職種」へ一本化する。

**Architecture:** 純ロジック（`src/lib/cq-submit.ts`・`src/lib/cq-board.ts`）はvitestでTDD、UI（`src/components/CqCapture.tsx`）は手動確認。サーバー側の必須チェックは `validateCqSubmission` に集約し、UIは同じ条件を先回りして親切なエラーを出すだけ。背景のソフト必須はUIのみの責務で、サーバーでは任意のまま。

**Tech Stack:** Next.js (App Router) / TypeScript / React / vitest / @notionhq/client

**Spec:** `docs/superpowers/specs/2026-07-31-cq-required-fields-design.md`

## Global Constraints

- 作業ブランチは `feat/cq-required-fields`。main へ直接コミットしない。
- 必須が効くのは「専門医に訊く」を届け先に選んだときだけ。「自分のメモ」だけに送る動作は疑問文1つで送れるまま変えない。
- 受付DBに該当プロパティが無くても投稿自体は失敗させない（`buildIntakeProperties` の既存方針）。
- 背景・状況はサーバー側では任意のまま。ソフト必須はUIの責務。
- `src/app/api/subscription/sync/_core.ts` と `src/lib/resolved-cqs.ts` は**変更しない**。
  前者の `投稿者職種` は Medical Knowledge_DB（サブスク用）の別プロパティ、後者は Algolia の
  `posterRole` フィールドを読むだけで、どちらも受付DBとは無関係。
- 職種の確定リスト（`CQ_OCCUPATIONS` の新しい値。この15個以外を増やさない）:
  `医師` / `看護師` / `保健師・助産師` / `薬剤師` / `管理栄養士・栄養士` / `臨床工学技士` /
  `診療放射線技師` / `臨床検査技師` / `理学療法士` / `作業療法士` / `言語聴覚士` /
  `救急救命士` / `学生（医学生・看護学生など）` / `その他医療従事者` / `その他`
- テスト実行は `npm test`（vitest run）。型チェックは `npx tsc --noEmit`。

---

### Task 1: 職種リストの差し替えと、受付DBの書き込み先を「職種」へ

**Files:**
- Modify: `src/lib/cq-submit.ts:20-36`（`CQ_OCCUPATIONS`）, `src/lib/cq-submit.ts:126-131`（コメント）, `src/lib/cq-submit.ts:157-159`（職種の書き込み）
- Test: `src/lib/__tests__/cq-submit.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `CQ_OCCUPATIONS: readonly string[]`（15要素・上記 Global Constraints の値）。
  `buildIntakeProperties(schema, value, userId)` のシグネチャは不変。
  書き込み先だけが `投稿者職種` → `職種`（無ければ `投稿者職種`）に変わる。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-submit.test.ts` の `describe('buildIntakeProperties', ...)` の中、
`it('型が合わないプロパティには書かない…')` の**直前**に以下を追加する。

```ts
  it('職種は「職種」列に書く（外部フォームと同じ列に寄せる）', () => {
    const schema: IntakePropSchema = {
      疑問: { type: 'title' },
      職種: { type: 'select' },
      投稿者職種: { type: 'select' },
    }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['職種']).toEqual({ select: { name: '看護師' } })
    // 両方あっても旧列には二重に書かない
    expect(r.properties['投稿者職種']).toBeUndefined()
  })

  it('「職種」列が無い受付DBでは旧列「投稿者職種」に書く', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, 投稿者職種: { type: 'select' } }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['投稿者職種']).toEqual({ select: { name: '看護師' } })
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: FAIL — 「職種は「職種」列に書く」が `expected undefined to deeply equal { select: { name: '看護師' } }` で落ちる。

- [ ] **Step 3: `CQ_OCCUPATIONS` を差し替える**

`src/lib/cq-submit.ts` の `CQ_OCCUPATIONS` 定義（コメント含む）を、以下でまるごと置き換える。

```ts
// 職種の固定リスト。受付DBの「職種」列（外部Notionフォームが書き込む列）の選択肢と
// 一致させる。自由記述にしない（表示の粒度と品位を保つ）。
// 旧リストの「学生」は「学生（医学生・看護学生など）」に、「管理栄養士」は
// 「管理栄養士・栄養士」に対応する。
export const CQ_OCCUPATIONS = [
  '医師',
  '看護師',
  '保健師・助産師',
  '薬剤師',
  '管理栄養士・栄養士',
  '臨床工学技士',
  '診療放射線技師',
  '臨床検査技師',
  '理学療法士',
  '作業療法士',
  '言語聴覚士',
  '救急救命士',
  '学生（医学生・看護学生など）',
  'その他医療従事者',
  'その他',
] as const
```

- [ ] **Step 4: 書き込み先を「職種」に変える**

`src/lib/cq-submit.ts` の以下3行を

```ts
  if (value.occupation && schema['投稿者職種']?.type === 'select') {
    properties['投稿者職種'] = { select: { name: value.occupation } }
  }
```

これで置き換える。

```ts
  // 職種は受付DBの「職種」に書く（外部Notionフォームと同じ列）。
  // 「職種」が無く旧列「投稿者職種」だけの受付DBではそちらへ書く
  // （列が無くても投稿を失敗させない、という既存方針の延長）。
  if (value.occupation) {
    if (schema['職種']?.type === 'select') {
      properties['職種'] = { select: { name: value.occupation } }
    } else if (schema['投稿者職種']?.type === 'select') {
      properties['投稿者職種'] = { select: { name: value.occupation } }
    }
  }
```

- [ ] **Step 5: 期待プロパティ名のコメントを直す**

`src/lib/cq-submit.ts` の以下のコメント行を

```ts
// 期待するプロパティ名（任意・受付DBにあれば書き込まれる）:
//   投稿者職種（select）／ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
//   出典（rich_text）／投稿経路（select: "アプリ内"）
```

これで置き換える。

```ts
// 期待するプロパティ名（任意・受付DBにあれば書き込まれる）:
//   背景・状況（rich_text）／職種（select・無ければ旧列 投稿者職種）／経験年数（select）／
//   ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
//   出典（rich_text）／投稿経路（select: "アプリ内"）
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: PASS（このファイルの全テスト）

- [ ] **Step 7: コミット**

```bash
git add src/lib/cq-submit.ts src/lib/__tests__/cq-submit.test.ts
git commit -m "feat(cq): 職種の選択肢を受付DBの「職種」列に揃え、書き込み先を一本化"
```

---

### Task 2: ボードが「職種」を読むようにする（外部フォーム由来のバッジ欠落を直す）

**Files:**
- Modify: `src/lib/cq-board.ts:78-92`（`toBoardCqs` の中）
- Test: `src/lib/__tests__/cq-board.test.ts`

**Interfaces:**
- Consumes: Task 1 の書き込み先変更（受付DBの `職種` 列に職種が入るようになる）
- Produces: `toBoardCqs(pages)` の返す `BoardCq.posterRole` が「`職種` → 空なら `投稿者職種`」の順で決まる。型は不変。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-board.test.ts` の `describe('toBoardCqs', ...)` の中、
最初の `it('ボード公開ONの未対応ページを板の項目にする', ...)` の**直後**に追加する。

```ts
  it('職種は「職種」列を優先し、無ければ旧列「投稿者職種」で補う', () => {
    // 両方ある: 新しい「職種」が勝つ
    const both = toBoardCqs([
      page({ properties: { 職種: { type: 'select', select: { name: '薬剤師' } } } }),
    ])
    expect(both[0].posterRole).toBe('薬剤師')

    // 旧列だけ（過去のアプリ内投稿）: 旧列を読む
    const legacyOnly = toBoardCqs([page()])
    expect(legacyOnly[0].posterRole).toBe('看護師')

    // 新列だけ（外部フォーム由来）: これまでバッジが出ていなかったケース
    const newOnly = toBoardCqs([
      page({
        properties: {
          職種: { type: 'select', select: { name: '理学療法士' } },
          投稿者職種: { type: 'select', select: null },
        },
      }),
    ])
    expect(newOnly[0].posterRole).toBe('理学療法士')
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- src/lib/__tests__/cq-board.test.ts`
Expected: FAIL — `expected '看護師' to be '薬剤師'`（新列を見ていないため）

- [ ] **Step 3: `toBoardCqs` を直す**

`src/lib/cq-board.ts` の

```ts
    const wantsPenName = selectName(propOf(page, '掲載名の希望')) === PEN_NAME_ALLOWED
    const posterName = wantsPenName ? plainText(propOf(page, 'ペンネーム'), 'rich_text') : ''
```

の直後に、この2行を挿入する。

```ts
    // 職種は外部フォームが書く「職種」を優先し、旧アプリ内投稿の「投稿者職種」で補う。
    const posterRole = selectName(propOf(page, '職種')) || selectName(propOf(page, '投稿者職種'))
```

続く `items.push({...})` の中の

```ts
      posterRole: selectName(propOf(page, '投稿者職種')),
```

を

```ts
      posterRole,
```

に置き換える。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- src/lib/__tests__/cq-board.test.ts`
Expected: PASS（このファイルの全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/cq-board.ts src/lib/__tests__/cq-board.test.ts
git commit -m "fix(cq): ボードが外部フォーム由来の職種を読めていなかった問題を修正"
```

---

### Task 3: サーバー側で職種・経験年数を必須にする

**Files:**
- Modify: `src/lib/cq-submit.ts:90-98`（職種・経験年数の検証）
- Test: `src/lib/__tests__/cq-submit.test.ts`（既存テストの前提を必須ありに更新）

**Interfaces:**
- Consumes: Task 1 の `CQ_OCCUPATIONS`
- Produces: `validateCqSubmission(input)` が `occupation` 未選択で
  `{ ok: false, error: '職種を選択してください' }`、`experience` 未選択で
  `{ ok: false, error: '経験年数を選択してください' }` を返す。
  返り値の型（`CqSubmission`）は不変。

- [ ] **Step 1: 失敗するテストを書く（既存テストの前提も必須ありへ更新）**

`src/lib/__tests__/cq-submit.test.ts` を4箇所いじる。

**(1)** `describe('validateCqSubmission', ...)` 冒頭の

```ts
  const valid = { question: '人工呼吸器のウィーニング、SBTの合格基準は？' }
```

を、必須3点セットに置き換える。

```ts
  // 必須は 疑問文・職種・経験年数 の3つ（背景はサーバー側では任意）。
  const valid = {
    question: '人工呼吸器のウィーニング、SBTの合格基準は？',
    occupation: '看護師',
    experience: '2〜3年目',
  }
```

**(2)** 最初の `it('最低限（疑問文のみ）で通る', ...)` をまるごと置き換える。

```ts
  it('必須（疑問文・職種・経験年数）が揃えば通る', () => {
    const r = validateCqSubmission(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.question).toBe(valid.question)
      expect(r.value.occupation).toBe('看護師')
      expect(r.value.experience).toBe('2〜3年目')
      expect(r.value.penName).toBe('')
      expect(r.value.notify).toBe(false)
    }
  })
```

**(3)** 疑問文の長さを見る2つのテストが `valid` を使うように直す（今は職種が無く必ず落ちる）。
以下2つを、それぞれ置き換える。

```ts
  it('短すぎる疑問文は拒否（境界値）', () => {
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MIN - 1) }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MIN) }).ok).toBe(true)
  })

  it('長すぎる疑問文は拒否（境界値）', () => {
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MAX) }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MAX + 1) }).ok).toBe(false)
  })
```

**(4)** `it('職種はリスト外を拒否、リスト内と未選択は通す', ...)` をまるごと置き換える
（経験年数の必須テストもここに並べる）。

```ts
  it('職種は必須。未選択もリスト外も拒否する', () => {
    expect(validateCqSubmission({ ...valid, occupation: '' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, occupation: '宇宙飛行士' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, occupation: '看護師' }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, occupation: '学生（医学生・看護学生など）' }).ok).toBe(true)
  })

  it('経験年数は必須。未選択もリスト外も拒否する', () => {
    expect(validateCqSubmission({ ...valid, experience: '' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, experience: '100年目' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, experience: '2〜3年目' }).ok).toBe(true)
  })
```

**(5)** `describe('背景・経験年数', ...)` の中の

```ts
  const valid = { question: '人工呼吸器のウィーニング、SBTの合格基準は？' }
```

を置き換える。

```ts
  const valid = {
    question: '人工呼吸器のウィーニング、SBTの合格基準は？',
    occupation: '看護師',
    experience: '2〜3年目',
  }
```

さらに、この describe の最後にある
`it('経験年数はリスト外を拒否、リスト内と未選択は通す', ...)` は
(4) に移したので**削除する**。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: FAIL — 「職種は必須…」で `expected true to be false`（未選択が通ってしまう）

- [ ] **Step 3: 検証を必須にする**

`src/lib/cq-submit.ts` の

```ts
  const occupation = str(input.occupation)
  if (occupation && !(CQ_OCCUPATIONS as readonly string[]).includes(occupation)) {
    return { ok: false, error: '職種はリストから選択してください' }
  }

  const experience = str(input.experience)
  if (experience && !(CQ_EXPERIENCE_YEARS as readonly string[]).includes(experience)) {
    return { ok: false, error: '経験年数はリストから選択してください' }
  }
```

を、これで置き換える。

```ts
  // 職種と経験年数は必須。どちらも1タップで、端末に記憶されるため
  // 壁になるのは初回だけ。逆にこの2つが無いと回答の前提が置けない。
  const occupation = str(input.occupation)
  if (!occupation) return { ok: false, error: '職種を選択してください' }
  if (!(CQ_OCCUPATIONS as readonly string[]).includes(occupation)) {
    return { ok: false, error: '職種はリストから選択してください' }
  }

  const experience = str(input.experience)
  if (!experience) return { ok: false, error: '経験年数を選択してください' }
  if (!(CQ_EXPERIENCE_YEARS as readonly string[]).includes(experience)) {
    return { ok: false, error: '経験年数はリストから選択してください' }
  }
```

- [ ] **Step 4: 背景が任意のままであることのコメントを更新**

`src/lib/cq-submit.ts` の

```ts
  // 背景は任意のまま（入力の負担を増やして投稿自体を止めない）。
  // ただし入っていれば回答の具体度が大きく変わるので、UI側で書きやすく促す。
```

を、これで置き換える。

```ts
  // 背景はサーバー側では任意のまま。空のときに一度だけ確認を挟む
  // 「ソフト必須」はUI（CqCapture）の責務で、ここでは弾かない。
```

- [ ] **Step 5: テスト全体が通ることを確認**

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 6: コミット**

```bash
git add src/lib/cq-submit.ts src/lib/__tests__/cq-submit.test.ts
git commit -m "feat(cq): 職種・経験年数をサーバー側で必須にする"
```

---

### Task 4: 投稿モーダルで職種・経験年数を必須にする

**Files:**
- Modify: `src/components/CqCapture.tsx:17`（import に `useRef`）, `:39-50`（`loadCqProfile`）, `:276-296`（state）, `:353-360`（`handleSend` 冒頭）, `:616-644`（職種・経験年数の select）

**Interfaces:**
- Consumes: Task 1 の `CQ_OCCUPATIONS`、Task 3 の必須検証（UIは同じ条件を先回りするだけ）
- Produces: なし（このタスクの変更を他タスクは参照しない）

- [ ] **Step 1: `useRef` を import する**

`src/components/CqCapture.tsx` の

```ts
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
```

を

```ts
import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
```

に置き換える。

- [ ] **Step 2: 旧リストの職種値を落とす（プロフィールの移行）**

`loadCqProfile` の中の

```ts
    return {
      occupation: String(raw.occupation || ''),
      experience: String(raw.experience || ''),
      penName: String(raw.penName || ''),
    }
```

を、これで置き換える。

```ts
    // 職種の選択肢を受付DBの「職種」列に揃えたため、旧リストにしか無かった値
    // （学生・管理栄養士）は空に落として選び直してもらう。
    const occupation = String(raw.occupation || '')
    return {
      occupation: (CQ_OCCUPATIONS as readonly string[]).includes(occupation) ? occupation : '',
      experience: String(raw.experience || ''),
      penName: String(raw.penName || ''),
    }
```

- [ ] **Step 3: 入力欄への参照を用意する**

`CqCaptureModal` の中、`const [mounted, setMounted] = useState(false)` の**直後**に追加する。

```ts
  // 必須欄が未入力のとき、エラー表示だけでなく該当欄へフォーカスを返す。
  const occupationRef = useRef<HTMLSelectElement | null>(null)
  const experienceRef = useRef<HTMLSelectElement | null>(null)
```

- [ ] **Step 4: 送信時に必須チェックを入れる**

`handleSend` の中の

```ts
    if (willSendExpert && trimmed.length < QUESTION_MIN) {
      setExpertError(`疑問文は${QUESTION_MIN}文字以上で入力してください`)
      return
    }
```

の**直後**に、これを挿入する。

```ts
    // 職種・経験年数は必須。送信ボタンはdisabledにせず、押した時に理由を出す
    // （disabledだと「なぜ押せないか」が伝わらない）。
    if (willSendExpert && !profile.occupation) {
      setExpertError('職種を選択してください')
      occupationRef.current?.focus()
      return
    }
    if (willSendExpert && !profile.experience) {
      setExpertError('経験年数を選択してください')
      experienceRef.current?.focus()
      return
    }
```

- [ ] **Step 5: select にラベルと必須マークを付ける**

現在のブロックは以下（ペンネームの `<input type="text">` の直前にある。
ファイル内に `<div className="flex gap-2">` は複数あるので、`CQ_OCCUPATIONS.map` を
含むこのブロックであることを確認してから置き換える）。

```tsx
                      <div className="flex gap-2">
                        <select
                          value={profile.occupation}
                          onChange={(e) => setProfile((p) => ({ ...p, occupation: e.target.value }))}
                          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          aria-label="職種（任意）"
                        >
                          <option value="">職種（任意）</option>
                          {CQ_OCCUPATIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        {/* 経験年数は回答の深さ・前提の置き方を変える。1タップで済むので負担にならない。 */}
                        <select
                          value={profile.experience}
                          onChange={(e) => setProfile((p) => ({ ...p, experience: e.target.value }))}
                          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          aria-label="経験年数（任意）"
                        >
                          <option value="">経験年数（任意）</option>
                          {CQ_EXPERIENCE_YEARS.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>
```

これを、まるごとこれで置き換える。

```tsx
                      {/* 職種・経験年数は必須。どちらも1タップで、端末に記憶されるため
                          壁になるのは初回だけ。経験年数は回答の深さ・前提の置き方を変える。 */}
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0 space-y-1">
                          <label htmlFor="cq-occupation" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                            職種<span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                          </label>
                          <select
                            id="cq-occupation"
                            ref={occupationRef}
                            value={profile.occupation}
                            onChange={(e) => {
                              setProfile((p) => ({ ...p, occupation: e.target.value }))
                              setExpertError('')
                            }}
                            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          >
                            <option value="">選択してください</option>
                            {CQ_OCCUPATIONS.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <label htmlFor="cq-experience" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                            経験年数<span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                          </label>
                          <select
                            id="cq-experience"
                            ref={experienceRef}
                            value={profile.experience}
                            onChange={(e) => {
                              setProfile((p) => ({ ...p, experience: e.target.value }))
                              setExpertError('')
                            }}
                            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          >
                            <option value="">選択してください</option>
                            {CQ_EXPERIENCE_YEARS.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
```

- [ ] **Step 6: 型チェックとテストを通す**

Run: `npx tsc --noEmit`
Expected: エラーなし（何も出力されず終了コード0）

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 7: コミット**

```bash
git add src/components/CqCapture.tsx
git commit -m "feat(cq): 投稿モーダルで職種・経験年数を必須にする"
```

---

### Task 5: 背景・状況をソフト必須にする

**Files:**
- Modify: `src/components/CqCapture.tsx`（`handleSend` のシグネチャと冒頭、背景欄まわり、送信ボタンの `onClick`）

**Interfaces:**
- Consumes: Task 4 の `useRef` import と必須チェックの位置
- Produces: なし（このタスクの変更を他タスクは参照しない）

- [ ] **Step 1: 確認バーの state と背景欄の参照を足す**

Task 4 の Step 3 で足した2つの ref の**直後**に追加する。

```ts
  const backgroundRef = useRef<HTMLTextAreaElement | null>(null)
  // 背景が空のまま送信を押したときに出す確認バー（ソフト必須）。
  const [bgPrompt, setBgPrompt] = useState(false)
```

- [ ] **Step 2: `handleSend` を「確認を飛ばせる」形にする**

`const handleSend = async () => {` を、これに置き換える。

```ts
  // skipBgPrompt: 確認バーの「このまま送る」から呼ばれたときだけ true。
  // state 更新を待たずにそのまま送るため、引数で渡す。
  const handleSend = async (opts?: { skipBgPrompt?: boolean }) => {
```

- [ ] **Step 3: 背景が空なら一度だけ確認する**

Task 4 の Step 4 で足した経験年数チェックの**直後**に、これを挿入する。

```ts
    // 背景が空のときは送らずに一度だけ確認する。書くか、そのまま送るかは本人が選ぶ。
    if (willSendExpert && !background.trim() && !opts?.skipBgPrompt) {
      setBgPrompt(true)
      return
    }
```

- [ ] **Step 4: 背景欄のラベルと補足文を直し、ref を付ける**

背景欄のラベルを

```tsx
                        <label htmlFor="cq-background" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                          背景・状況<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span>
                        </label>
```

から、これに置き換える。

```tsx
                        <label htmlFor="cq-background" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                          背景・状況
                        </label>
```

同じ `<textarea id="cq-background"` に `ref` と `onChange` の確認バー解除を加える。
`value={background}` の直前に `ref={backgroundRef}` を挿し、`onChange` を

```tsx
                          onChange={(e) => setBackground(e.target.value)}
```

から

```tsx
                          onChange={(e) => {
                            setBackground(e.target.value)
                            setBgPrompt(false)
                          }}
```

に置き換える。

さらに、その下の補足文

```tsx
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                          {title.trim().length >= QUESTION_MIN && !background.trim()
                            ? 'どんな場面か・何を試したか・何に迷っているかが一言あると、回答がぐっと具体的になります。'
                            : '患者背景・場面・これまでの対応など。具体的なほど回答の精度が上がります。'}
                        </p>
```

を、これに置き換える。

```tsx
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                          空でも送れますが、あると回答の精度が変わります。
                          患者背景・場面・これまでの対応など。
                        </p>
```

- [ ] **Step 5: 確認バーを描画する**

Step 4 で置き換えた `<p>` の**直後**（背景欄を包む `<div className="space-y-1">` の中）に、
確認バーを追加する。

```tsx
                        {bgPrompt && (
                          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 space-y-2">
                            <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                              背景が空のままです。どんな場面で・何を試して・何に迷っているかが一言あると、答えられる疑問になります。
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setBgPrompt(false)
                                  backgroundRef.current?.focus()
                                }}
                                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-1.5 text-xs font-semibold transition-colors"
                              >
                                背景を書く
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBgPrompt(false)
                                  handleSend({ skipBgPrompt: true })
                                }}
                                className="flex-1 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-lg py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                              >
                                このまま送る
                              </button>
                            </div>
                          </div>
                        )}
```

- [ ] **Step 6: 背景欄の上のコメントを実態に合わせる**

背景欄の直前にある以下のコメントを

```tsx
                      {/* 背景・状況。専門医が答えられるかどうかは、ほぼここで決まる。
                          任意のままにして投稿の足を止めないが、既定で開いて置き、
                          「何を書けばよいか」を例で示して書きやすくする。
                          例文は上の疑問文の例と同じ症例（敗血症性ショック）で揃える。
                          患者背景・場面・試したこと（数値）・迷っている点の4つを1文ずつ含め、
                          これを読めば書き方が分かるようにする。片方だけ直さない。 */}
```

これに置き換える。

```tsx
                      {/* 背景・状況。専門医が答えられるかどうかは、ほぼここで決まる。
                          ソフト必須（空でも送れるが、送信時に一度だけ確認を挟む）。
                          「何を書けばよいか」を例で示して書きやすくする。
                          例文は上の疑問文の例と同じ症例（敗血症性ショック）で揃える。
                          患者背景・場面・試したこと（数値）・迷っている点の4つを1文ずつ含め、
                          これを読めば書き方が分かるようにする。片方だけ直さない。 */}
```

- [ ] **Step 7: 送信ボタンがクリックイベントを引数に渡さないようにする**

送信ボタンの

```tsx
                onClick={handleSend}
```

を

```tsx
                onClick={() => handleSend()}
```

に置き換える（そのままだとReactのクリックイベントが `opts` に入る）。

- [ ] **Step 8: 型チェックとテストを通す**

Run: `npx tsc --noEmit`
Expected: エラーなし（何も出力されず終了コード0）

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 9: ビルドが通ることを確認**

Run: `npm run build`
Expected: `Compiled successfully` を含み、終了コード0

- [ ] **Step 10: コミット**

```bash
git add src/components/CqCapture.tsx
git commit -m "feat(cq): 背景・状況が空なら一度だけ確認する（ソフト必須）"
```

---

### Task 6: Notion側の選択肢リネームと動作確認

**Files:** なし（Notionの手作業とローカル確認）

**Interfaces:**
- Consumes: Task 1〜5 のすべて
- Produces: なし（最終タスク）

**⚠️ 順序厳守:** Notion側のリネームを**先に**済ませる。逆順でデプロイすると、
リネーム前の受付DBに新しい選択肢名で書き込まれ、optionが自動生成されて重複する。

- [ ] **Step 1: 受付DBの「職種」の選択肢をリネームする（オーナーの手作業）**

対象: [❓ MediNode 臨床疑問受付_DB](https://app.notion.com/p/88b5241c1cdc48228ae4a1ba3ed54120)

「職種」プロパティの選択肢 `医学生` を `学生（医学生・看護学生など）` にリネームする。
（現在この選択肢を使っている行は0件なので、既存データへの影響はない）

- [ ] **Step 2: リネーム結果を確認する**

受付DBの「職種」プロパティを開き、選択肢が以下の15個になっていることを目で確認する。

```
学生（医学生・看護学生など） / 医師 / 看護師 / 保健師・助産師 / 薬剤師 /
管理栄養士・栄養士 / 臨床工学技士 / 診療放射線技師 / 臨床検査技師 /
理学療法士 / 作業療法士 / 言語聴覚士 / 救急救命士 / その他医療従事者 / その他
```

（Notion側の並び順はアプリの表示順と一致しなくてよい）

- [ ] **Step 3: ローカルで投稿モーダルの挙動を確認する**

Run: `npm run dev`

ブラウザで開き、プレミアム設定のある状態で「専門医に訊く」を選び、以下を確認する。

1. 疑問文だけ書いて送信 → 「職種を選択してください」が出て、職種のselectにフォーカスが当たる
2. 職種を選んで送信 → 「経験年数を選択してください」が出る
3. 経験年数を選んで送信 → 背景が空なので確認バーが出る（送信されない）
4. 「背景を書く」 → 確認バーが消え、背景欄にフォーカスが当たる
5. 背景を空のまま再度送信 → 確認バーが再度出る → 「このまま送る」で送信される
6. 「自分のメモ」だけを届け先にした場合は、疑問文だけで送信できる（詳細パネルが出ない）

- [ ] **Step 4: 受付DBに「職種」で届いていることを確認**

Step 3 の送信が受付DBに1行増え、`職種`（`投稿者職種` ではない）に選んだ値、
`経験年数` に選んだ値、`投稿経路` が `アプリ内` で入っていることを確認する。
確認できたらそのテスト行は削除する。

- [ ] **Step 5: 全テストとビルドの最終確認**

Run: `npm test`
Expected: PASS（全ファイル）

Run: `npm run build`
Expected: `Compiled successfully` を含み、終了コード0

- [ ] **Step 6: main へのマージとデプロイ**

superpowers:finishing-a-development-branch に従って、mainへのマージ方法を決める。
mainへのpushで本番デプロイが走る（CLIデプロイは使わない運用）。

---

## 完了の定義

- アプリ内で「専門医に訊く」に投稿するとき、職種と経験年数を選ばないと送れない
- 背景が空のときは一度だけ確認が出て、本人が選べば空のまま送れる
- 職種が受付DBの `職種` 列に入る
- みんなの臨床疑問ボードに、外部フォーム由来の投稿の職種バッジが出る
- `npm test` と `npm run build` が通る
