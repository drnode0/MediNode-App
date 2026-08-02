# Phase 1: スキーマ推定＋確認UI＋本文フォールバック 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存NotionのDBを「列名を1文字も入力せずに」つなげるようにする（推定＋ドロップダウン確認）＋要約列の無いページを本文冒頭で索引できるようにする。

**Architecture:** `/api/notion/check-props` がDBの全列（名前・型）を返すよう拡張し、純関数 `inferPropMap` が役割（要約/キーワード/ジャンル/知識レベル）ごとの候補を推定。共有コンポーネント `PropMapEditor` が SetupWizard と SettingsPanel の手入力欄を置き換える。本文フォールバックは同期API内で「要約が空のページのみ」blocks APIから冒頭を抜粋し、`summarySource` フラグで出どころをUIに明示する。

**Tech Stack:** Next.js (App Router) / TypeScript / vitest / @notionhq/client / Algolia

**Spec:** `docs/superpowers/specs/2026-08-02-connection-onboarding-redesign-design.md`

## Global Constraints

- 文言は「静かな日本語」。煽らない・AI主役にしない・感嘆符を使わない
- 新しい依存パッケージを追加しない
- 既存の `propSummary/propKeywords/propKnowledgeLevel/propGenre` と `buildPropMap()` の配線を壊さない（保存形式は変えない）
- `npx tsc --noEmit` と `npx vitest run` が各タスク完了時に全パスしていること
- コミットは日本語メッセージ＋ `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 作業ブランチ: `feat/schema-mapping`（mainから作成。最初のタスクで作る）
- specからの確定した読み替え2点:
  1. specの「同期パネルに進捗表示」は**今回は見送り**（同期は単一POSTで、ページ単位の進捗はストリーミング化が必要な別工事）。代わりにトグル文言の「同期が遅くなります」で期待値を管理する
  2. ドロップダウンの「使わない」選択肢は**設けない**。保存モデル（空文字=既定名）に「使わない」を表現する場所がなく、列が無い場合は単に読み飛ばされて無害なため。選択肢は「既定のまま」＋実列名のみ

---

### Task 1: inferPropMap 純関数

**Files:**
- Create: `src/lib/prop-infer.ts`
- Test: `src/lib/__tests__/prop-infer.test.ts`

**Interfaces:**
- Produces: `inferPropMap(schema: NotionPropSchema[]): PropMapInference`、型 `NotionPropSchema = { name: string; type: string }`、`RoleInference = { best: string | null; candidates: string[]; confidence: 'exact' | 'likely' | 'guess' | 'none' }`、`PropMapInference = { summary: RoleInference; keywords: RoleInference; genre: RoleInference; knowledgeLevel: RoleInference }`。Task 3/4 が import する。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/prop-infer.test.ts`:

```ts
// 列名推定（inferPropMap）のテスト。
// 既存DBの列名を書き換えずにつなぐため、スキーマ（名前と型）から
// 役割ごとの候補を推定する。1つの列は1つの役割にしか割り当てない。
import { describe, it, expect } from 'vitest'
import { inferPropMap } from '../prop-infer'

const p = (name: string, type: string) => ({ name, type })

describe('inferPropMap', () => {
  it('既定名が型ごと揃っていれば全役割 exact', () => {
    const r = inferPropMap([
      p('名前', 'title'),
      p('要約', 'rich_text'),
      p('キーワード', 'multi_select'),
      p('ジャンル', 'multi_select'),
      p('知識レベル', 'select'),
    ])
    expect(r.summary).toMatchObject({ best: '要約', confidence: 'exact' })
    expect(r.keywords).toMatchObject({ best: 'キーワード', confidence: 'exact' })
    expect(r.genre).toMatchObject({ best: 'ジャンル', confidence: 'exact' })
    expect(r.knowledgeLevel).toMatchObject({ best: '知識レベル', confidence: 'exact' })
  })

  it('類似名を likely として推定する（サマリー→要約、カテゴリ→ジャンル）', () => {
    const r = inferPropMap([
      p('名前', 'title'),
      p('サマリー', 'rich_text'),
      p('カテゴリ', 'multi_select'),
    ])
    expect(r.summary).toMatchObject({ best: 'サマリー', confidence: 'likely' })
    expect(r.genre).toMatchObject({ best: 'カテゴリ', confidence: 'likely' })
  })

  it('名前が一致しても型が合わなければ採用しない（要約が number）', () => {
    const r = inferPropMap([p('名前', 'title'), p('要約', 'number')])
    expect(r.summary.best).toBeNull()
    expect(r.summary.confidence).toBe('none')
  })

  it('1つの列を2役割に割り当てない（タグはキーワードが取り、ジャンルは none）', () => {
    const r = inferPropMap([p('名前', 'title'), p('タグ', 'multi_select')])
    expect(r.keywords).toMatchObject({ best: 'タグ', confidence: 'likely' })
    expect(r.genre.best).toBeNull()
    expect(r.genre.candidates).not.toContain('タグ')
  })

  it('名前が導けず型だけ合う列は guess（候補のみ・bestなし）', () => {
    const r = inferPropMap([p('名前', 'title'), p('ひとこと', 'rich_text')])
    expect(r.summary).toMatchObject({ best: null, confidence: 'guess' })
    expect(r.summary.candidates).toContain('ひとこと')
  })

  it('大文字小文字を無視して英語同義語も拾う（Summary→要約）', () => {
    const r = inferPropMap([p('名前', 'title'), p('Summary', 'rich_text')])
    expect(r.summary).toMatchObject({ best: 'Summary', confidence: 'likely' })
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/prop-infer.test.ts`
Expected: FAIL（`Cannot find module '../prop-infer'`）

- [ ] **Step 3: 実装**

`src/lib/prop-infer.ts`:

```ts
// 列名の推定。DBスキーマ（列名と型）から、MediNodeの4役割
// （要約/キーワード/ジャンル/知識レベル）に対応する列の候補を出す。
// 方針: 既定名の完全一致 > 型が合う中での類似名 > 型だけ合う（候補のみ）。
// 1つの列は1つの役割にしか割り当てない（先に決まった役割が優先）。

export type NotionPropSchema = { name: string; type: string }

export type RoleInference = {
  best: string | null
  candidates: string[]
  confidence: 'exact' | 'likely' | 'guess' | 'none'
}

export type PropMapInference = {
  summary: RoleInference
  keywords: RoleInference
  genre: RoleInference
  knowledgeLevel: RoleInference
}

type Role = keyof PropMapInference

// 判定順は summary → keywords → genre → knowledgeLevel。
// 競合時（同じ列が複数役割に合う）は先の役割が取る。
const ROLES: Role[] = ['summary', 'keywords', 'genre', 'knowledgeLevel']

const DEFAULT_NAMES: Record<Role, string> = {
  summary: '要約',
  keywords: 'キーワード',
  genre: 'ジャンル',
  knowledgeLevel: '知識レベル',
}

const ALLOWED_TYPES: Record<Role, string[]> = {
  summary: ['rich_text'],
  keywords: ['multi_select', 'rich_text'],
  genre: ['multi_select', 'select', 'status'],
  knowledgeLevel: ['select', 'status', 'multi_select'],
}

// 類似名（部分一致・小文字化して比較）。配列の順序がスコア順。
const SYNONYMS: Record<Role, string[]> = {
  summary: ['サマリー', '概要', 'まとめ', 'summary', 'abstract'],
  keywords: ['タグ', 'keyword', 'tag', 'kw'],
  genre: ['カテゴリ', '分類', '領域', '科', 'genre', 'category'],
  knowledgeLevel: ['レベル', '段階', '成熟度', 'level', 'stage'],
}

export function inferPropMap(schema: NotionPropSchema[]): PropMapInference {
  const claimed = new Set<string>()
  const result = {} as PropMapInference

  for (const role of ROLES) {
    const allowed = schema.filter(
      (s) => ALLOWED_TYPES[role].includes(s.type) && !claimed.has(s.name),
    )
    let best: string | null = null
    let confidence: RoleInference['confidence'] = 'none'

    // 1. 既定名の完全一致（型も合っていること）
    const exact = allowed.find((s) => s.name === DEFAULT_NAMES[role])
    if (exact) {
      best = exact.name
      confidence = 'exact'
    } else {
      // 2. 類似名（部分一致・大文字小文字無視）。同義語リストの順で最初に当たったもの
      const lower = (s: string) => s.toLowerCase()
      outer: for (const syn of SYNONYMS[role]) {
        for (const s of allowed) {
          if (lower(s.name).includes(lower(syn))) {
            best = s.name
            confidence = 'likely'
            break outer
          }
        }
      }
      // 3. 型だけ合う列があれば guess（候補のみ）
      if (!best && allowed.length > 0) confidence = 'guess'
    }

    if (best) claimed.add(best)
    result[role] = {
      best,
      candidates: allowed.filter((s) => s.name !== best).map((s) => s.name),
      confidence,
    }
  }
  return result
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/prop-infer.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: ブランチ作成とコミット**

```bash
cd ~/medical-search-public
git checkout -b feat/schema-mapping
git add src/lib/prop-infer.ts src/lib/__tests__/prop-infer.test.ts
git commit -m "列名推定 inferPropMap を追加（既定名/類似名/型フィルタ/一意割当）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: check-props がDBスキーマを返す

**Files:**
- Modify: `src/app/api/notion/check-props/route.ts`
- Test: `src/lib/__tests__/check-props-route.test.ts`（新規）

**Interfaces:**
- Consumes: なし（独立）
- Produces: レスポンスに `medical.schema: Array<{name, type}>`（Reference指定時は `reference.schema` も）。Task 3/4 がこの schema を `inferPropMap` と `PropMapEditor` に渡す。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/check-props-route.test.ts`:

```ts
// check-props API のテスト。接続確認に加えて、列名マッピングUIのために
// DBの全プロパティ（名前と型）を schema として返すことを担保する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { guardMock, retrieveMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  retrieveMock: vi.fn(),
}))

vi.mock('@/lib/api-guard', () => ({ requireSessionOrSetupRateLimit: guardMock }))
vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = { retrieve: retrieveMock }
  },
}))

import { POST } from '../../app/api/notion/check-props/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) =>
  ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue(null)
  retrieveMock.mockReset()
})

describe('POST /api/notion/check-props', () => {
  it('missing判定に加えて schema（列名と型の一覧）を返す', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        名前: { type: 'title' },
        サマリー: { type: 'rich_text' },
        カテゴリ: { type: 'multi_select' },
      },
    })
    const res = await POST(makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db1' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.medical.missing).toContain('要約')
    expect(data.medical.schema).toEqual([
      { name: '名前', type: 'title' },
      { name: 'サマリー', type: 'rich_text' },
      { name: 'カテゴリ', type: 'multi_select' },
    ])
  })

  it('Reference DB 指定時は reference.schema も返す', async () => {
    retrieveMock
      .mockResolvedValueOnce({ properties: { 名前: { type: 'title' } } })
      .mockResolvedValueOnce({ properties: { 論文名: { type: 'title' }, 要約: { type: 'rich_text' } } })
    const res = await POST(
      makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db1', notionReferenceDbId: 'db2' }),
    )
    const data = await res.json()
    expect(data.reference.schema).toEqual([
      { name: '論文名', type: 'title' },
      { name: '要約', type: 'rich_text' },
    ])
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/lib/__tests__/check-props-route.test.ts`
Expected: FAIL（`data.medical.schema` が undefined）

- [ ] **Step 3: route を拡張**

`src/app/api/notion/check-props/route.ts` の該当部を次のように変更（result型に schema を追加し、retrieve結果から組み立てる）:

```ts
    const notion = new Client({ auth: notionToken })
    const toSchema = (props: Record<string, unknown>) =>
      Object.entries(props).map(([name, p]) => ({
        name,
        type: ((p as { type?: string }).type as string) || 'unknown',
      }))
    const result: {
      medical: { found: string[]; missing: string[]; schema: Array<{ name: string; type: string }> }
      reference?: { found: string[]; missing: string[]; schema: Array<{ name: string; type: string }> }
    } = { medical: { found: [], missing: [], schema: [] } }

    // Medical DB
    const medicalDb = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const medicalPropsObj = ((medicalDb as { properties?: Record<string, unknown> }).properties || {}) as Record<string, unknown>
    const medicalProps = Object.keys(medicalPropsObj)
    result.medical.found = medicalRequired.filter((p) => medicalProps.includes(p))
    result.medical.missing = medicalRequired.filter((p) => !medicalProps.includes(p))
    result.medical.schema = toSchema(medicalPropsObj)

    // Reference DB（任意）
    if (notionReferenceDbId) {
      const refDb = await notion.databases.retrieve({ database_id: notionReferenceDbId })
      const refPropsObj = ((refDb as { properties?: Record<string, unknown> }).properties || {}) as Record<string, unknown>
      const refProps = Object.keys(refPropsObj)
      result.reference = {
        found: referenceRequired.filter((p) => refProps.includes(p)),
        missing: referenceRequired.filter((p) => !refProps.includes(p)),
        schema: toSchema(refPropsObj),
      }
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/check-props-route.test.ts && npx tsc --noEmit`
Expected: PASS（2件）・tsc 0エラー

- [ ] **Step 5: コミット**

```bash
git add src/app/api/notion/check-props/route.ts src/lib/__tests__/check-props-route.test.ts
git commit -m "check-props がDBの全列（名前・型）を schema として返すように拡張

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PropMapEditor コンポーネント＋SettingsPanel置き換え

**Files:**
- Create: `src/components/PropMapEditor.tsx`
- Modify: `src/components/SettingsPanel.tsx`（「列名がちがうとき」details内の4つの手入力欄を置き換え）

**Interfaces:**
- Consumes: Task 1 の `inferPropMap`, `NotionPropSchema`／Task 2 の `medical.schema`
- Produces: `<PropMapEditor schema value onChange />`。`value = { propSummary: string; propKeywords: string; propKnowledgeLevel: string; propGenre: string }`、`onChange(patch: Partial<value>)`。Task 4 も同じコンポーネントを使う。

- [ ] **Step 1: PropMapEditor を実装**

`src/components/PropMapEditor.tsx`:

```tsx
'use client'

// 列名マッピングのドロップダウンUI。手入力（タイプミスの温床）を排し、
// 実際にDBにある列名からだけ選ばせる。選択肢は役割ごとに型で絞る。
// 空文字 = 既定名（要約/キーワード/ジャンル/知識レベル）をそのまま読む。

import { inferPropMap, type NotionPropSchema } from '@/lib/prop-infer'

export type PropMapValue = {
  propSummary: string
  propKeywords: string
  propKnowledgeLevel: string
  propGenre: string
}

const ROWS: Array<{
  key: keyof PropMapValue
  role: 'summary' | 'keywords' | 'genre' | 'knowledgeLevel'
  label: string
  defaultName: string
}> = [
  { key: 'propSummary', role: 'summary', label: '要約', defaultName: '要約' },
  { key: 'propKeywords', role: 'keywords', label: 'キーワード', defaultName: 'キーワード' },
  { key: 'propGenre', role: 'genre', label: 'ジャンル', defaultName: 'ジャンル' },
  { key: 'propKnowledgeLevel', role: 'knowledgeLevel', label: '知識レベル', defaultName: '知識レベル' },
]

export function PropMapEditor({
  schema,
  value,
  onChange,
}: {
  schema: NotionPropSchema[]
  value: PropMapValue
  onChange: (patch: Partial<PropMapValue>) => void
}) {
  const inference = inferPropMap(schema)
  return (
    <div className="space-y-2.5">
      {ROWS.map((row) => {
        const inf = inference[row.role]
        // 選択肢: 推定best → その他候補。既に保存済みの値がリスト外なら先頭に足す（列名変更後の残骸も見えるように）
        const options = [inf.best, ...inf.candidates].filter((n): n is string => !!n)
        if (value[row.key] && !options.includes(value[row.key])) options.unshift(value[row.key])
        return (
          <div key={row.key} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300">{row.label}</span>
            <span className="text-gray-400 dark:text-gray-500 text-xs">←</span>
            <select
              value={value[row.key]}
              onChange={(e) => onChange({ [row.key]: e.target.value })}
              className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              <option value="">既定（「{row.defaultName}」を読む）</option>
              {options.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: SettingsPanel の details 内を置き換え**

`src/components/SettingsPanel.tsx` — 「列名がちがうとき」`<details>` の中身（説明文＋4つの `<input>` ＋末尾の再同期注記）を次に差し替える。schema保持用のstateを追加する:

コンポーネント上部（notionTest state の近く）に追加:

```tsx
  // 列名マッピング用: 接続テストで取得したDBスキーマ（列名と型）
  const [dbSchema, setDbSchema] = useState<Array<{ name: string; type: string }> | null>(null)
```

`handleNotionConnTest` の成功パス（`setNotionTest(...)` の直前）に追加:

```tsx
      setDbSchema((data.medical?.schema as Array<{ name: string; type: string }>) || null)
```

details の中身:

```tsx
                  <div className="p-3 space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      MediNodeは既定で「要約」「キーワード」「知識レベル」「ジャンル」という列を読みます。
                      すでに別の名前で書きためている場合は、<strong>そのDBでの列</strong>をここで選んでください。Notion側の列名を変える必要はありません。
                    </p>
                    {!dbSchema ? (
                      <button
                        type="button"
                        onClick={handleNotionConnTest}
                        disabled={notionTesting || !notionForm.notionToken.trim() || !notionForm.notionMedicalDbId.trim()}
                        className="w-full border border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-300 rounded-xl py-2.5 text-xs font-semibold hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors disabled:opacity-50"
                      >
                        {notionTesting ? '読み込み中...' : 'Notionから列を読み込む'}
                      </button>
                    ) : (
                      <PropMapEditor
                        schema={dbSchema}
                        value={{
                          propSummary: notionForm.propSummary,
                          propKeywords: notionForm.propKeywords,
                          propKnowledgeLevel: notionForm.propKnowledgeLevel,
                          propGenre: notionForm.propGenre,
                        }}
                        onChange={(patch) => setNotionForm((f) => ({ ...f, ...patch }))}
                      />
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                      変更したら「保存する」のあと、<strong>再同期</strong>すると読み替えが反映されます。
                    </p>
                  </div>
```

import を追加: `import { PropMapEditor } from './PropMapEditor'`

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 両方パス

- [ ] **Step 4: ブラウザ確認**

devサーバー（launch設定 `medinode`）で:
1. 設定 → Notion接続設定 → 「列名がちがうとき」を開く
2. Token/DB未入力なら「Notionから列を読み込む」がdisabledであること
3. （実Tokenがあれば）読み込み後、4行のドロップダウンに実列名だけが並ぶこと・「既定（「要約」を読む）」が選べること

- [ ] **Step 5: コミット**

```bash
git add src/components/PropMapEditor.tsx src/components/SettingsPanel.tsx
git commit -m "列名マッピングをドロップダウン化（PropMapEditor＋設定画面の置き換え）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SetupWizard に推定＋確認カード

**Files:**
- Modify: `src/components/SetupWizard.tsx`（接続テスト成功/警告パスと `renderNotionTestBlock`）

**Interfaces:**
- Consumes: Task 1 `inferPropMap`／Task 2 `medical.schema`／Task 3 `PropMapEditor`

- [ ] **Step 1: schema state と推定プリフィルを追加**

`SetupWizard.tsx` の `notionTest` state 近くに追加:

```tsx
  const [dbSchema, setDbSchema] = useState<Array<{ name: string; type: string }> | null>(null)
```

`handleNotionTest` の成功パス（`setNotionTest(...)` の直前）に追加。**推定プリフィルは空欄のみ**（ユーザーが入れた値を上書きしない）:

```tsx
      const schema = (data.medical?.schema as Array<{ name: string; type: string }>) || null
      setDbSchema(schema)
      if (schema) {
        const inf = inferPropMap(schema)
        setForm((f) => ({
          ...f,
          propSummary: f.propSummary || (inf.summary.confidence === 'likely' ? inf.summary.best || '' : ''),
          propKeywords: f.propKeywords || (inf.keywords.confidence === 'likely' ? inf.keywords.best || '' : ''),
          propGenre: f.propGenre || (inf.genre.confidence === 'likely' ? inf.genre.best || '' : ''),
          propKnowledgeLevel: f.propKnowledgeLevel || (inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || '' : ''),
        }))
      }
```

import を追加: `import { inferPropMap } from '@/lib/prop-infer'` と `import { PropMapEditor } from './PropMapEditor'`

- [ ] **Step 2: 警告ブロックの手入力欄（2026-08-01追加分）をPropMapEditorに置き換え**

`renderNotionTestBlock` 内 `notionTest?.status === 'warn'` ブロックの「既存DBの列名をここで読み替える」`<div className="space-y-2 pt-1">`（3つの手入力`<input>`のmap）を次に差し替える。「この列名でもう一度テスト」ボタンは残す:

```tsx
          <div className="space-y-2 pt-1">
            {dbSchema && (
              <PropMapEditor
                schema={dbSchema}
                value={{
                  propSummary: form.propSummary,
                  propKeywords: form.propKeywords,
                  propKnowledgeLevel: form.propKnowledgeLevel,
                  propGenre: form.propGenre,
                }}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              />
            )}
            <button
              type="button"
              onClick={handleNotionTest}
              disabled={notionTesting}
              className="w-full border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 rounded-lg py-2 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
            >
              {notionTesting ? '確認中...' : 'この設定でもう一度テスト'}
            </button>
          </div>
```

- [ ] **Step 3: 成功パスにも確認カードを出す**

`notionTest?.status === 'ok'` ブロックを次に差し替え（全役割が既定名で揃っている場合は一行、読み替えが効いている場合はその旨）:

```tsx
      {notionTest?.status === 'ok' && (
        <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400 space-y-1">
          <p className="text-center font-medium">
            <CheckCircle2 className="inline-block h-4 w-4 align-text-bottom mr-1.5" />Notionに接続できました
          </p>
          {(form.propSummary || form.propKeywords || form.propGenre || form.propKnowledgeLevel) ? (
            <p className="text-xs text-green-600 dark:text-green-300 text-center">
              列の読み替えあり:
              {form.propSummary && ` 要約←${form.propSummary}`}
              {form.propKeywords && ` キーワード←${form.propKeywords}`}
              {form.propGenre && ` ジャンル←${form.propGenre}`}
              {form.propKnowledgeLevel && ` 知識レベル←${form.propKnowledgeLevel}`}
            </p>
          ) : (
            <p className="text-xs text-green-600 dark:text-green-300 text-center">既定の列名をそのまま読みます</p>
          )}
        </div>
      )}
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 両方パス

- [ ] **Step 5: ブラウザ確認**

devサーバーでセットアップ（既存DB連携ルート）へ進み:
1. 接続テスト（列が欠けたDB相当がなければ、既定テンプレDBで成功パスの「既定の列名をそのまま読みます」を確認）
2. 警告パスではドロップダウン＋「この設定でもう一度テスト」が出ること（実DBが無い場合はUIの表示のみ確認）

- [ ] **Step 6: コミット**

```bash
git add src/components/SetupWizard.tsx
git commit -m "セットアップ接続テストに列の推定プリフィルと確認カードを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 本文抜粋ヘルパー extractBodyExcerpt

**Files:**
- Create: `src/lib/notion-body.ts`
- Test: `src/lib/__tests__/notion-body.test.ts`

**Interfaces:**
- Produces: `extractBodyExcerpt(blocks: unknown[], maxLen?: number): string`（既定 maxLen=300）。Task 6 が同期APIで使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/notion-body.test.ts`:

```ts
// 本文フォールバック用の抜粋関数。blocks APIの結果から本文テキストを
// つないで maxLen で切る。テキストを持たないブロックは読み飛ばす。
import { describe, it, expect } from 'vitest'
import { extractBodyExcerpt } from '../notion-body'

const para = (text: string) => ({
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: text }] },
})

describe('extractBodyExcerpt', () => {
  it('段落テキストを空白でつなぐ', () => {
    expect(extractBodyExcerpt([para('一文目。'), para('二文目。')])).toBe('一文目。 二文目。')
  })

  it('maxLen で切り詰める', () => {
    expect(extractBodyExcerpt([para('あ'.repeat(400))], 300)).toHaveLength(300)
  })

  it('見出し・箇条書き・引用も拾う', () => {
    const blocks = [
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '見出し' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: '項目' }] } },
      { type: 'quote', quote: { rich_text: [{ plain_text: '引用' }] } },
    ]
    expect(extractBodyExcerpt(blocks)).toBe('見出し 項目 引用')
  })

  it('テキストを持たないブロック（画像等）は読み飛ばす', () => {
    const blocks = [{ type: 'image', image: {} }, para('本文')]
    expect(extractBodyExcerpt(blocks)).toBe('本文')
  })

  it('空配列なら空文字', () => {
    expect(extractBodyExcerpt([])).toBe('')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/lib/__tests__/notion-body.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/notion-body.ts`:

```ts
// Notion blocks API の結果から本文冒頭の抜粋を作る。
// 要約列が空のページを索引するためのフォールバック（spec 1d）。

const TEXT_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'callout',
  'toggle',
] as const

export function extractBodyExcerpt(blocks: unknown[], maxLen = 300): string {
  const parts: string[] = []
  let total = 0
  for (const block of blocks) {
    const b = block as Record<string, unknown>
    const type = b.type as string
    if (!TEXT_BLOCK_TYPES.includes(type as (typeof TEXT_BLOCK_TYPES)[number])) continue
    const payload = b[type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
    const text = (payload?.rich_text || [])
      .map((t) => t.plain_text || '')
      .join('')
      .trim()
    if (!text) continue
    parts.push(text)
    total += text.length
    if (total >= maxLen) break
  }
  return parts.join(' ').slice(0, maxLen)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/notion-body.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/notion-body.ts src/lib/__tests__/notion-body.test.ts
git commit -m "本文フォールバック用の抜粋関数 extractBodyExcerpt を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 同期APIの本文フォールバック

**Files:**
- Modify: `src/app/api/sync/route.ts`（リクエストに `bodyFallback`、`syncMedicalDb` に本文取得）
- Modify: `src/lib/settings.ts`（`syncBodyFallback?: boolean` を AppSettings に追加）

**Interfaces:**
- Consumes: Task 5 `extractBodyExcerpt`
- Produces: 同期リクエストの新パラメータ `bodyFallback?: boolean`。Algoliaレコードの新フィールド `summarySource: 'property' | 'body'`。Task 7 のUIが読む。

対象は **Medical DB（個人・部署）のみ**。Reference DBは対象外（文献は要約欄運用が前提のため）。

- [ ] **Step 1: settings に型を追加**

`src/lib/settings.ts` の `hideCqButton?: boolean` の直後に追加:

```ts
  // 本文フォールバック（任意・パワーモードの同期のみ）。
  // ONのとき、要約が空のページは本文冒頭を代わりに索引する（同期は遅くなる）。
  syncBodyFallback?: boolean
```

- [ ] **Step 2: sync route を変更**

`src/app/api/sync/route.ts`:

(a) import に追加:

```ts
import { extractBodyExcerpt } from '@/lib/notion-body'
```

(b) リクエスト分割代入（`testOnly,` の下）に `bodyFallback,` を追加。

(c) `syncMedicalDb` のシグネチャに `bodyFallback: boolean,` を追加（`propMap: PropMap,` の後）。呼び出し側2箇所（個人・部署）に `Boolean(bodyFallback)` を渡す。部署にも同じ値を渡す（部署DBでも要約なし運用はあり得るため）。

(d) レコード構築部を変更。`aiSummary` を let に取り出し、空なら blocks を1回だけ取得:

```ts
      let aiSummary = extractText(getProp(props, summaryKey, '要約'))
      let summarySource: 'property' | 'body' = 'property'
      if (!aiSummary && bodyFallback) {
        // 要約が空のページに限り、本文冒頭を代わりに索引する（オプトイン）。
        // ページごとに1リクエスト増えるため、失敗はスキップして同期全体は止めない。
        try {
          const blocks = await notion.blocks.children.list({ block_id: page.id, page_size: 20 })
          const excerpt = extractBodyExcerpt(blocks.results as unknown[], 300)
          if (excerpt) {
            aiSummary = excerpt
            summarySource = 'body'
          }
        } catch {
          // 権限不足・アーカイブ済みなどは黙って property 扱いのまま進める
        }
      }
      records.push({
        // …既存フィールドはそのまま…
        aiSummary,
        summarySource,
```

（`records.push` 内の既存 `aiSummary: extractText(...)` 行を上記の変数参照に置き換え、`summarySource` を1フィールド追加する。他のフィールドは変更しない）

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 両方パス（sync routeの既存テストがあれば summarySource 追加で壊れていないこと）

- [ ] **Step 4: コミット**

```bash
git add src/app/api/sync/route.ts src/lib/settings.ts
git commit -m "同期に本文フォールバックを追加（要約が空のページのみ・オプトイン・summarySource付与）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: トグルUIと「本文から自動抜粋」表示

**Files:**
- Modify: `src/components/SyncPanel.tsx`（トグル＋リクエストに bodyFallback）
- Modify: `src/components/ResultCard.tsx`（summarySource==='body' のラベル）

**Interfaces:**
- Consumes: Task 6 の `syncBodyFallback` 設定と `summarySource` フィールド

- [ ] **Step 1: SyncPanel にトグルを追加**

`src/components/SyncPanel.tsx` — 同期実行ボタンの上に追加（`getSettings`/`saveSettings` は `@/lib/settings` から。saveSettings が未importなら追加）。ローカルstateで即時反映し、変更時に保存する:

```tsx
  const [bodyFallback, setBodyFallback] = useState<boolean>(() => !!getSettings()?.syncBodyFallback)
```

```tsx
          <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={bodyFallback}
              onChange={(e) => {
                const on = e.target.checked
                setBodyFallback(on)
                const cur = getSettings()
                if (cur) saveSettings({ ...cur, syncBodyFallback: on })
              }}
              className="mt-0.5 accent-brand-600"
            />
            <span>
              本文も検索対象にする（要約が空のページだけ・同期が遅くなります）
            </span>
          </label>
```

同期リクエストのbody（`propMap: buildPropMap(settings),` の後）に追加:

```ts
          bodyFallback: !!settings.syncBodyFallback,
```

- [ ] **Step 2: ResultCard にラベルを追加**

`src/components/ResultCard.tsx` — Hit 型（`aiSummary?: string` の近く）に追加:

```ts
  summarySource?: 'property' | 'body'
```

要約表示部（`displaySummary` を描画している箇所）の直後に追加:

```tsx
      {hit.summarySource === 'body' && displaySummary && (
        <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500 align-middle">本文から自動抜粋</span>
      )}
```

（描画位置は `displaySummary` の `<p>` 内末尾。既存のレイアウトを崩さないようインライン要素にする）

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 両方パス

- [ ] **Step 4: ブラウザ確認**

1. 検索タブ上部の「データを再同期する」パネルにトグルが出ること・ON/OFFがリロード後も保持されること（localStorage確認: `medical_search_settings` の `syncBodyFallback`）
2. （実データがあれば）要約空のページを同期→検索結果に「本文から自動抜粋」ラベルが付くこと

- [ ] **Step 5: コミット**

```bash
git add src/components/SyncPanel.tsx src/components/ResultCard.tsx
git commit -m "本文フォールバックのトグルと「本文から自動抜粋」表示を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 仕上げ（FAQ同期・全体確認・マージ準備）

**Files:**
- Modify: `src/lib/help-faq.ts`（setup-props の回答をドロップダウン化に合わせて微修正）

- [ ] **Step 1: FAQ文言を実装に合わせる**

`src/lib/help-faq.ts` の `id: 'setup-props'` の回答文中、「列名（例: 要約→サマリー）を入れれば」を「実際の列名から選ぶだけで」に更新（手入力の記述を残さない）:

```ts
    a: 'テンプレートから始めた場合は、そのまま（「名前」「ジャンル」「知識レベル」「要約」「キーワード」）にしておくのが簡単です。ただし、すでに別の名前で書きためている既存DBを、名前を揃えるために一括編集する必要はありません。設定 →「Notion接続設定」→「列名がちがうとき」で、DBにある実際の列名から選ぶだけで、MediNodeがその列を読みます。なお同期が必須にしているのはタイトル列だけで、他の列が無いページも取り込まれます。「本文も検索対象にする」をONにすると、要約が空のページは本文の冒頭を代わりに索引します（同期は遅くなります）。選択肢の値（ジャンル名など）は自由に追加・変更できます。',
```

- [ ] **Step 2: 全テスト・型チェック・ビルド**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: すべて成功

- [ ] **Step 3: コミットしてレビューへ**

```bash
git add src/lib/help-faq.ts
git commit -m "FAQ setup-props をドロップダウン化・本文フォールバックに合わせて更新

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

マージ・デプロイはオーナー確認後（superpowers:finishing-a-development-branch に従う）。

## 手動E2Eチェックリスト（マージ前）

- [ ] 既定名テンプレDB: 接続テスト→「既定の列名をそのまま読みます」→同期→検索OK
- [ ] 列名がちがうDB（例: サマリー/タグ/カテゴリ）: 警告→ドロップダウンにプリフィル→再テストで解消→同期→検索でヒット
- [ ] 本文フォールバックON: 要約空ページが検索に出て「本文から自動抜粋」ラベルつき
- [ ] 本文フォールバックOFF（既定）: 挙動が従来と同一
- [ ] 設定画面の「列名がちがうとき」: 列読み込み→選択→保存→再同期で反映
