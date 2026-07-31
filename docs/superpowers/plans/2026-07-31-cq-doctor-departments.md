# 医師の「診療科・立場」を受け取る Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリ内のCQ投稿で、職種に「医師」を選んだ人にだけ「診療科・立場」を必須で訊き、受付DBの既存 `診療科・立場`（multi_select）列に書く。

**Architecture:** 純ロジック（定数・検証・プロパティ組み立て）は `src/lib/cq-submit.ts` に寄せて vitest でTDD。UIは `src/components/CqCapture.tsx` のトグルチップで、既存の職種・経験年数と同じ流儀（送信ボタンは disabled にせず、押した時に理由とフォーカスを出す）。Notion側は列も選択肢も既存のものを使うので変更ゼロ。

**Tech Stack:** Next.js (App Router) / TypeScript / React / vitest / @notionhq/client

**Spec:** `docs/superpowers/specs/2026-07-31-cq-doctor-departments-design.md`

## Global Constraints

- 作業ブランチは `feat/cq-doctor-departments`（main `f5b9ef2` 基点）。main へ直接コミットしない。
- 追加項目が出るのは「専門医に訊く」を届け先に選び、**かつ職種が `医師` のとき**だけ。
- 「自分のメモ」だけに送る動作は疑問文1つで送れるまま変えない。
- 受付DBに `診療科・立場` 列が無くても投稿自体は失敗させない（`buildIntakeProperties` の既存方針）。
- 職種が `医師` 以外なら `departments` はサーバー側で**空配列に正規化**する（エラーにしない）。
- 診療科・立場の確定リスト（この7個以外を増やさない。受付DBの選択肢と一字一句一致させる）:
  `初期研修医` / `専攻医（専門研修中）` / `指導医・専門医` / `救急科` / `集中治療科` / `麻酔科` / `その他の診療科`
- エラー文言: 未選択 `診療科・立場を選択してください` / リスト外 `診療科・立場はリストから選択してください`
- Notion受付DBのスキーマは変更しない。外部Notionフォームの設定も変更しない。
- ダークモードは `.dark` クラス基準（`@media (prefers-color-scheme)` を使わない）。
- テスト実行は `npm test`（vitest run）。型チェックは `npx tsc --noEmit`。

---

### Task 1: 定数・型・サーバー検証

**Files:**
- Modify: `src/lib/cq-submit.ts`（定数の追加、`CqSubmission` / `CqSubmissionInput`、`validateCqSubmission`）
- Test: `src/lib/__tests__/cq-submit.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `CQ_DOCTOR_DEPARTMENTS: readonly string[]`（7要素・上記 Global Constraints の値）
  - `CQ_DEPARTMENT_OCCUPATION: '医師'`（診療科・立場を訊く職種）
  - `CqSubmission` に `departments: string[]` が加わる（医師以外では必ず `[]`）
  - `validateCqSubmission` の返り値の形は変わらない（`{ok:true,value} | {ok:false,error}`）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-submit.test.ts` の `describe('validateCqSubmission', ...)` の中、
`it('経験年数は必須。未選択もリスト外も拒否する', ...)` の**直後**に以下を追加する。

```ts
  // 診療科・立場（医師のみ）。「医師」の一語では初期研修医と集中治療科の指導医が
  // 区別できず、回答の前提が置けない。医師以外が送ってきた値は黙って捨てる。
  it('診療科・立場は医師のとき必須', () => {
    const doctor = { ...valid, occupation: '医師' }
    expect(validateCqSubmission({ ...doctor, departments: [] }).ok).toBe(false)
    expect(validateCqSubmission(doctor).ok).toBe(false)
    const ok = validateCqSubmission({ ...doctor, departments: ['集中治療科'] })
    expect(ok.ok && ok.value.departments).toEqual(['集中治療科'])
  })

  it('診療科・立場はリスト外を拒否する', () => {
    const r = validateCqSubmission({
      ...valid,
      occupation: '医師',
      departments: ['集中治療科', '宇宙科'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('診療科・立場はリストから選択してください')
  })

  it('診療科・立場の重複は取り除く', () => {
    const r = validateCqSubmission({
      ...valid,
      occupation: '医師',
      departments: ['救急科', '救急科', '麻酔科'],
    })
    expect(r.ok && r.value.departments).toEqual(['救急科', '麻酔科'])
  })

  it('医師以外の診療科・立場は黙って捨てる（エラーにしない）', () => {
    const r = validateCqSubmission({ ...valid, occupation: '看護師', departments: ['救急科'] })
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.departments).toEqual([])
  })

  it('診療科・立場が配列でなければ空として扱う', () => {
    const r = validateCqSubmission({ ...valid, occupation: '看護師', departments: '救急科' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.departments).toEqual([])
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: FAIL — 「診療科・立場は医師のとき必須」が `expected true to be false`（医師でも通ってしまう）

- [ ] **Step 3: 定数を追加する**

`src/lib/cq-submit.ts` の `CQ_EXPERIENCE_YEARS` 定義の**直後**に追加する。

```ts
// 医師の診療科・立場。受付DBの「診療科・立場」列（multi_select）の選択肢と一致させる。
// 立場（初期研修医〜指導医）と診療科が1つの列に同居しているのは受付DB側の既存構造で、
// 外部Notionフォームと集計を揃えるためそのまま使う。
export const CQ_DOCTOR_DEPARTMENTS = [
  '初期研修医',
  '専攻医（専門研修中）',
  '指導医・専門医',
  '救急科',
  '集中治療科',
  '麻酔科',
  'その他の診療科',
] as const

// 診療科・立場を訊く職種。今はここだけ（他職種の内訳は実データを見てから判断する）。
export const CQ_DEPARTMENT_OCCUPATION = '医師'
```

- [ ] **Step 4: 型に `departments` を足す**

`src/lib/cq-submit.ts` の `CqSubmission` の

```ts
  experience: string // '' = 選択なし
  penName: string // '' = 匿名
```

を、これで置き換える。

```ts
  experience: string // '' = 選択なし
  departments: string[] // 職種が「医師」のときだけ入る。それ以外は必ず []
  penName: string // '' = 匿名
```

続けて `CqSubmissionInput` の

```ts
  experience?: unknown
  penName?: unknown
```

を、これで置き換える。

```ts
  experience?: unknown
  departments?: unknown
  penName?: unknown
```

- [ ] **Step 5: 検証を実装する**

`src/lib/cq-submit.ts` の経験年数チェック

```ts
  const experience = str(input.experience)
  if (!experience) return { ok: false, error: '経験年数を選択してください' }
  if (!(CQ_EXPERIENCE_YEARS as readonly string[]).includes(experience)) {
    return { ok: false, error: '経験年数はリストから選択してください' }
  }
```

の**直後**に、これを挿入する。

```ts
  // 診療科・立場は医師のときだけ必須。「医師」の一語では初期研修医と集中治療科の
  // 指導医が区別できず、回答の前提が置けない。
  // 医師以外が送ってきた値は黙って捨てる（看護師の投稿に救急科が付いた行を作らない）。
  let departments: string[] = []
  if (occupation === CQ_DEPARTMENT_OCCUPATION) {
    const raw = Array.isArray(input.departments) ? input.departments.map(str).filter(Boolean) : []
    if (raw.some((d) => !(CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))) {
      return { ok: false, error: '診療科・立場はリストから選択してください' }
    }
    departments = [...new Set(raw)]
    if (departments.length === 0) {
      return { ok: false, error: '診療科・立場を選択してください' }
    }
  }
```

- [ ] **Step 6: 返り値に `departments` を足す**

`src/lib/cq-submit.ts` の return 文の

```ts
      occupation,
      experience,
      penName,
```

を、これで置き換える。

```ts
      occupation,
      experience,
      departments,
      penName,
```

- [ ] **Step 7: 既存テストのフィクスチャに `departments` を足す**

`CqSubmission` に必須フィールドが増えたので、`buildIntakeProperties` に渡している
既存フィクスチャ2つが型エラーになる。両方に `departments: []` を足す。

`describe('buildIntakeProperties', ...)` 冒頭の `const value = {` の中、`experience: '',` の直後に:

```ts
    departments: [],
```

`describe('buildIntakeProperties（背景・経験年数）', ...)` の `const base = {` の中、
`experience: '',` の直後に同じ1行を足す:

```ts
    departments: [],
```

- [ ] **Step 8: テストと型チェックが通ることを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: PASS（このファイルの全テスト）

Run: `npx tsc --noEmit`
Expected: エラーなし（何も出力されず終了コード0）

- [ ] **Step 9: コミット**

```bash
git add src/lib/cq-submit.ts src/lib/__tests__/cq-submit.test.ts
git commit -m "feat(cq): 医師の診療科・立場をサーバー側で受け取り検証する"
```

---

### Task 2: 受付DBの「診療科・立場」に書く

**Files:**
- Modify: `src/lib/cq-submit.ts`（`buildIntakeProperties` と、その上の期待プロパティ名コメント）
- Test: `src/lib/__tests__/cq-submit.test.ts`

**Interfaces:**
- Consumes: Task 1 の `CqSubmission.departments`（`string[]`・医師以外では `[]`）
- Produces: `buildIntakeProperties` が `診療科・立場`（multi_select）を積むようになる。シグネチャは不変。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-submit.test.ts` の `describe('buildIntakeProperties', ...)` の中、
`it('型が合わないプロパティには書かない…')` の**直前**に以下を追加する。

```ts
  it('診療科・立場（multi_select）に積む', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, '診療科・立場': { type: 'multi_select' } }
    const r = buildIntakeProperties(
      schema,
      { ...value, occupation: '医師', departments: ['集中治療科', '指導医・専門医'] },
      null,
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['診療科・立場']).toEqual({
      multi_select: [{ name: '集中治療科' }, { name: '指導医・専門医' }],
    })
  })

  it('診療科・立場が空なら列自体を積まない（空で上書きしない）', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, '診療科・立場': { type: 'multi_select' } }
    const r = buildIntakeProperties(schema, { ...value, departments: [] }, null)
    if ('error' in r) throw new Error('unexpected')
    expect('診療科・立場' in r.properties).toBe(false)
  })

  it('受付DBに診療科・立場の列が無ければ黙って飛ばす（投稿は成立させる）', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' } }
    const r = buildIntakeProperties(
      schema,
      { ...value, occupation: '医師', departments: ['救急科'] },
      null,
    )
    if ('error' in r) throw new Error('unexpected')
    expect(Object.keys(r.properties)).toEqual(['疑問'])
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- src/lib/__tests__/cq-submit.test.ts`
Expected: FAIL — 「診療科・立場（multi_select）に積む」が
`expected undefined to deeply equal { multi_select: [ … ] }` で落ちる

- [ ] **Step 3: 実装する**

`src/lib/cq-submit.ts` の経験年数を積むブロック

```ts
  if (value.experience && schema['経験年数']?.type === 'select') {
    properties['経験年数'] = { select: { name: value.experience } }
  }
```

の**直後**に、これを挿入する。

```ts
  // 診療科・立場（医師のみ・複数選択可）。空のときは列ごと積まない
  // （既存値を空で上書きしない、という既存方針に揃える）。
  if (value.departments.length > 0 && schema['診療科・立場']?.type === 'multi_select') {
    properties['診療科・立場'] = {
      multi_select: value.departments.map((name) => ({ name })),
    }
  }
```

- [ ] **Step 4: 期待プロパティ名のコメントを直す**

`src/lib/cq-submit.ts` の以下のコメント行を

```ts
// 期待するプロパティ名（任意・受付DBにあれば書き込まれる）:
//   背景・状況（rich_text）／職種（select・無ければ旧列 投稿者職種）／経験年数（select）／
//   ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
//   出典（rich_text）／投稿経路（select: "アプリ内"）
```

これで置き換える。

```ts
// 期待するプロパティ名（任意・受付DBにあれば書き込まれる）:
//   背景・状況（rich_text）／職種（select・無ければ旧列 投稿者職種）／経験年数（select）／
//   診療科・立場（multi_select・医師のみ）／
//   ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
//   出典（rich_text）／投稿経路（select: "アプリ内"）
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 6: コミット**

```bash
git add src/lib/cq-submit.ts src/lib/__tests__/cq-submit.test.ts
git commit -m "feat(cq): 診療科・立場を受付DBのmulti_select列に書く"
```

---

### Task 3: 投稿モーダルに診療科・立場のチップを出す

**Files:**
- Modify: `src/components/CqCapture.tsx`（import、`CqProfile` と `loadCqProfile`、初期state、ref、職種の `onChange`、`handleSend` の必須チェック、POST body、チップUI）

**Interfaces:**
- Consumes: Task 1 の `CQ_DOCTOR_DEPARTMENTS` / `CQ_DEPARTMENT_OCCUPATION`、Task 1 のサーバー検証（UIは同じ条件を先回りするだけ）
- Produces: なし（このタスクの変更を他タスクは参照しない）

- [ ] **Step 1: 定数を import する**

`src/components/CqCapture.tsx` の

```ts
import { CQ_OCCUPATIONS, CQ_EXPERIENCE_YEARS, QUESTION_MIN, BACKGROUND_MAX, defaultDestinations, type CqIntent } from '@/lib/cq-submit'
```

を、これで置き換える。

```ts
import { CQ_OCCUPATIONS, CQ_EXPERIENCE_YEARS, CQ_DOCTOR_DEPARTMENTS, CQ_DEPARTMENT_OCCUPATION, QUESTION_MIN, BACKGROUND_MAX, defaultDestinations, type CqIntent } from '@/lib/cq-submit'
```

- [ ] **Step 2: プロフィールに `departments` を足す**

`src/components/CqCapture.tsx` の

```ts
type CqProfile = { occupation: string; experience: string; penName: string }
```

を、これで置き換える。

```ts
type CqProfile = { occupation: string; experience: string; penName: string; departments: string[] }
```

続けて `loadCqProfile` の中身

```ts
    // 職種の選択肢を受付DBの「職種」列に揃えたため、旧リストにしか無かった値
    // （学生・管理栄養士）は空に落として選び直してもらう。
    const occupation = String(raw.occupation || '')
    return {
      occupation: (CQ_OCCUPATIONS as readonly string[]).includes(occupation) ? occupation : '',
      experience: String(raw.experience || ''),
      penName: String(raw.penName || ''),
    }
  } catch {
    return { occupation: '', experience: '', penName: '' }
  }
```

を、これで置き換える。

```ts
    // 職種の選択肢を受付DBの「職種」列に揃えたため、旧リストにしか無かった値
    // （学生・管理栄養士）は空に落として選び直してもらう。
    const raw0 = String(raw.occupation || '')
    const occupation = (CQ_OCCUPATIONS as readonly string[]).includes(raw0) ? raw0 : ''
    // 診療科・立場は医師のときだけ持つ。職種が落ちた／医師でないなら一緒に捨てる。
    const departments = Array.isArray(raw.departments)
      ? (raw.departments as unknown[])
          .map((d) => String(d || ''))
          .filter((d) => (CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))
      : []
    return {
      occupation,
      experience: String(raw.experience || ''),
      penName: String(raw.penName || ''),
      departments: occupation === CQ_DEPARTMENT_OCCUPATION ? departments : [],
    }
  } catch {
    return { occupation: '', experience: '', penName: '', departments: [] }
  }
```

- [ ] **Step 3: 初期stateとrefを直す**

`CqCaptureModal` の中の

```ts
  const [profile, setProfile] = useState<CqProfile>({ occupation: '', experience: '', penName: '' })
```

を、これで置き換える。

```ts
  const [profile, setProfile] = useState<CqProfile>({ occupation: '', experience: '', penName: '', departments: [] })
```

続けて、既存の

```ts
  const experienceRef = useRef<HTMLSelectElement | null>(null)
```

の**直後**に、これを挿入する。

```ts
  // 診療科・立場は select ではなくチップ群。未選択のときは先頭のチップへフォーカスを返す。
  const departmentsRef = useRef<HTMLButtonElement | null>(null)
```

- [ ] **Step 4: 職種を医師以外に変えたら診療科を捨てる**

職種の select の `onChange`

```tsx
                            onChange={(e) => {
                              setProfile((p) => ({ ...p, occupation: e.target.value }))
                              setExpertError('')
                            }}
```

を、これで置き換える。

```tsx
                            onChange={(e) => {
                              const occupation = e.target.value
                              // 医師以外に変えたら診療科・立場は捨てる。UIが隠れるだけだと
                              // 看護師の投稿に救急科が付いたまま届く。
                              setProfile((p) => ({
                                ...p,
                                occupation,
                                departments: occupation === CQ_DEPARTMENT_OCCUPATION ? p.departments : [],
                              }))
                              setExpertError('')
                            }}
```

- [ ] **Step 5: チップ群を描画する**

職種・経験年数を包む `<div className="flex gap-2">` ブロックの**閉じタグ `</div>` の直後**、
ペンネームの `<input type="text"` の**直前**に、これを挿入する。

```tsx
                      {/* 診療科・立場。医師のときだけ。「医師」の一語では初期研修医と
                          集中治療科の指導医が区別できず、回答の前提が置けない。
                          複数選択なので select ではなくトグルチップにする（届け先チップと同じ操作感）。 */}
                      {profile.occupation === CQ_DEPARTMENT_OCCUPATION && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            診療科・立場
                            <span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                            <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">（複数選択可）</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {CQ_DOCTOR_DEPARTMENTS.map((d, i) => {
                              const on = profile.departments.includes(d)
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  ref={i === 0 ? departmentsRef : undefined}
                                  aria-pressed={on}
                                  onClick={() => {
                                    setProfile((p) => ({
                                      ...p,
                                      departments: on
                                        ? p.departments.filter((x) => x !== d)
                                        : [...p.departments, d],
                                    }))
                                    setExpertError('')
                                  }}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                                    on
                                      ? 'bg-purple-600 border-purple-600 text-white'
                                      : 'border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-300 hover:border-purple-400'
                                  }`}
                                >
                                  {d}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
```

- [ ] **Step 6: 送信時の必須チェックを足す**

`handleSend` の中の経験年数チェック

```ts
    if (willSendExpert && !profile.experience) {
      setExpertError('経験年数を選択してください')
      experienceRef.current?.focus()
      return
    }
```

の**直後**に、これを挿入する（背景ゲートより前・順序を守る）。

```ts
    if (
      willSendExpert &&
      profile.occupation === CQ_DEPARTMENT_OCCUPATION &&
      profile.departments.length === 0
    ) {
      setExpertError('診療科・立場を選択してください')
      departmentsRef.current?.focus()
      return
    }
```

- [ ] **Step 7: POST body に `departments` を足す**

`handleSend` の中の `/api/cq/submit` への POST body

```ts
                occupation: profile.occupation,
                experience: profile.experience,
                penName: profile.penName,
```

を、これで置き換える。

```ts
                occupation: profile.occupation,
                experience: profile.experience,
                departments: profile.departments,
                penName: profile.penName,
```

- [ ] **Step 8: 型チェック・テスト・ビルドを通す**

Run: `npx tsc --noEmit`
Expected: エラーなし（何も出力されず終了コード0）

Run: `npm test`
Expected: PASS（全ファイル）

Run: `npm run build`
Expected: `Compiled successfully` を含み、終了コード0

- [ ] **Step 9: コミット**

```bash
git add src/components/CqCapture.tsx
git commit -m "feat(cq): 医師を選んだときだけ診療科・立場を必須で訊く"
```

---

### Task 4: 動作確認とデプロイ

**Files:** なし（ローカル確認とマージ）

**Interfaces:**
- Consumes: Task 1〜3 のすべて
- Produces: なし（最終タスク）

- [ ] **Step 1: ローカルで挙動を確認する（オーナーのみ実施可）**

**この Step と Step 2 はプレミアム会員のセッションと受付DBのenv（`CQ_INTAKE_NOTION_TOKEN` /
`CQ_INTAKE_DB_ID`）が必要なので、エージェントの環境では踏めない。** デプロイ後に本番で
オーナーが確認する。飛ばした場合はその旨を報告に明記すること（黙って「確認済み」にしない）。

Run: `npm run dev`

ブラウザで開き、プレミアム設定のある状態で「専門医に訊く」を選び、以下を確認する。

1. 職種が未選択、または医師以外のとき → 診療科・立場のチップ群は**出ない**
2. 職種で「医師」を選ぶ → チップ群が出る
3. チップ未選択のまま送信 → 「診療科・立場を選択してください」が出て、先頭のチップにフォーカスが当たる
4. チップを2つ選んで送信 → 送れる（背景が空なら先に背景の確認バーが出る）
5. 「医師」で「救急科」を選んだあと職種を「看護師」に変える → チップ群が消える。
   もう一度「医師」に戻すと、**選択が空になっている**（前の選択が残らない）
6. 「自分のメモ」だけを届け先にした場合は、疑問文だけで送信できる（詳細パネルが出ない）

- [ ] **Step 2: 受付DBに届いた内容を確認する**

Step 1-4 の送信で受付DB
[❓ MediNode 臨床疑問受付_DB](https://app.notion.com/p/88b5241c1cdc48228ae4a1ba3ed54120)
に1行増え、`診療科・立場` に選んだ2つが入っていることを確認する。
`職種` が `医師`、`投稿経路` が `アプリ内` であることもあわせて確認する。
確認できたらそのテスト行は削除する。

- [ ] **Step 3: 最終確認**

Run: `npm test`
Expected: PASS（全ファイル）

Run: `npm run build`
Expected: `Compiled successfully` を含み、終了コード0

- [ ] **Step 4: main へマージしてデプロイ**

```bash
git fetch origin
git checkout main
git merge --ff-only origin/main
git merge --no-ff feat/cq-doctor-departments
```

マージ後に `npx tsc --noEmit` と `npm test` と `npm run build` をもう一度通してから push する。

```bash
git push origin main
```

push で本番デプロイが走る（CLIデプロイは使わない運用）。

---

## 完了の定義

- 職種に「医師」を選んだときだけ診療科・立場のチップが出る
- 1つ以上選ばないと専門医に送れない
- 職種を医師以外に変えると選択が捨てられる（UIが隠れるだけでない）
- 受付DBの `診療科・立場` 列に値が入る
- 「自分のメモ」だけに送る動作は疑問文1つで送れるまま
- `npm test` と `npx tsc --noEmit` と `npm run build` が通る
