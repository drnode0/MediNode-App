# スプレッド編集ビルダー｜使いにくさ3点の解消 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/spread-edit` で、部品を主役も含めて並べ替えられ、言い換えた文を1クリックで通せ、各節に出す原本の表・図を選べるようにする。

**Architecture:** 新しい部品 `{ kind: 'source'; blockId: string }` を足す。中身は写さず原本のブロックIDだけを持ち、描画は既存の `RenderedBlocks` に1件渡すだけにする。表層に上げたブロックは深掘りから除き、指す先を失った参照は参考文献と同じ fail-closed で保存を止める。編集画面は、既に実装済みの「スプレッドノートに追加」を全欄へ配線し、主役と追加を1本の並びとして扱い、表に出るものの一覧を先頭に常設する。

**Tech Stack:** Next.js（App Router）・TypeScript・React・vitest・Tailwind

設計書: `docs/superpowers/specs/2026-09-04-spread-editor-usability-design.md`

## Global Constraints

- **逐語照合の関数（`makeVerbatimChecker` / `verifyVerbatim`）は1文字も変えない。** 既存のテストが全部通ることで確かめる
- **原本の表・図の中身をオーバレイに写さない。** `source` 部品が持つのは `blockId` だけ
- **保存を止めるのは「間違いが読者に出るもの」だけ。** 未決の節が残っていても保存できる
- テストは `npm test`（vitest）。個別実行は `npx vitest run src/lib/__tests__/<file> -t '<name>'`
- コメントは日本語。既存ファイルのコメント密度に合わせる（「なぜそうしたか」を書く。何をしているかの逐語訳は書かない）
- ダッシュ（——）を使わない
- 事業数値・税務・健康・家族の文脈をコード・コメント・コミットメッセージに書かない（公開リポジトリのため）

## File Structure

| ファイル | 責任 | 変更 |
|---|---|---|
| `src/lib/reader-spread.ts` | 部品の型・正規化・逐語検査・表層への昇格・保存の関門 | 変更 |
| `src/lib/spread-namings.ts` | 表示上の命名を集める（逐語検査の対象外の文字列） | 変更 |
| `src/components/reader/spread/ReaderSpread.tsx` | スプレッドの描画。`source` 部品の解決はここ（`RenderedBlocks` を既に import しているため） | 変更 |
| `src/app/api/admin/spread/route.ts` | 保存の関門 | 変更 |
| `src/app/admin/spread-edit/SpreadEditClient.tsx` | 画面の枠・保存・赤表示 | 変更 |
| `src/app/admin/spread-edit/OverlayBuilder.tsx` | 節ごとの編集。851行あるので、新規UIは足さず切り出す | 変更 |
| `src/app/admin/spread-edit/SourcePicker.tsx` | 節の中の表・画像を候補として並べ、1つ選ぶ | 新規 |
| `src/app/admin/spread-edit/SurfaceChecklist.tsx` | 表に出るものの一覧（決定4） | 新規 |

`SpreadParts.tsx` は変更しない。`source` は本文ブロックの描画であって表層部品の見た目ではないため、`SpreadPartView` ではなく `ReaderSpread` 側で解決する（`SpreadParts.tsx` から `ReaderBody` を import すると描画の依存が逆向きに増える）。

---

### Task 1: `source` 部品の型と正規化

**Files:**
- Modify: `src/lib/reader-spread.ts`（`SpreadPart` の union・`KNOWN_PART_KINDS`・`stripPartHref`・`sanitizeOverlay`・`verbatimTargets`）
- Modify: `src/lib/spread-namings.ts:38-66`（`collectNamings` の switch）
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `SpreadPart` に `{ kind: 'source'; blockId: string }` が加わる。`sanitizeOverlay` が blockId の無い `source` を落とす

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-spread.test.ts` の末尾に足す。

```ts
describe('source 部品（原本の表・図を指すだけの部品）', () => {
  it('blockId を持つ source は sanitizeOverlay を通り、持たない source は落ちる', () => {
    const out = sanitizeOverlay({
      parts: { s1: { kind: 'source', blockId: 'blk-1' } },
      extraParts: {
        s2: [
          { kind: 'source', blockId: 'blk-2' },
          { kind: 'source', blockId: '  ' } as SpreadPart,
          { kind: 'source' } as unknown as SpreadPart,
        ],
      },
    })
    expect(out.parts).toEqual({ s1: { kind: 'source', blockId: 'blk-1' } })
    expect(out.extraParts).toEqual({ s2: [{ kind: 'source', blockId: 'blk-2' }] })
  })

  it('source は逐語検査の対象にしない（文字列を持たないため）', () => {
    const doc: ReaderDoc = {
      title: 'x', icon: null, cover: null, lastEdited: null,
      blocks: [{ kind: 'heading', level: 2, inlines: [{ text: '1. 節' }] }],
    }
    const spread = applyOverlay(buildSpreadDraft(doc, 'p'), {
      parts: { 'sec-1': { kind: 'source', blockId: 'どこにも無いID' } },
    })
    expect(verifyVerbatim(spread, doc, null).ok).toBe(true)
  })
})
```

`SpreadPart` 型を import に足すこと（ファイル先頭の import 文に `type SpreadPart` を追加）。

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts -t 'source 部品'
```

型エラー（`'source'` は `SpreadPart['kind']` に無い）で落ちること。

- [ ] **Step 3: 型を足す**

`src/lib/reader-spread.ts` の `SpreadPart` union、`| { kind: 'none' }` の直前に足す。

```ts
  // 原本の表・図をそのまま表層に出す部品。中身は持たず、原本のブロックID だけを指す。
  // 節の主役は「その節に最初に出てくる表」を自動で拾うだけなので、2つ目の表もグラフも
  // 表層に上げる手が無かった。中身を写す（comparison を渡す）と原本を直したときに
  // 黙って古くなるため、参考文献の紐づけ（sourceId）と同じくIDだけを持つ。
  // 文字列を持たないので逐語一致検査の対象は無い。指す先を失ったときは保存を止める。
  | { kind: 'source'; blockId: string }
```

- [ ] **Step 4: 正規化を通す**

`KNOWN_PART_KINDS` に `'source'` を足す。

```ts
const KNOWN_PART_KINDS = new Set<SpreadPart['kind']>(['comparison', 'matrix', 'flow', 'timeline', 'bignumber', 'gonogo', 'gauge', 'cards', 'note', 'decision', 'source', 'none'])
```

`stripPartHref` の switch に `case 'source':` を足す（`case 'none': return part` の直前）。

```ts
    case 'source':
      return part
```

`KNOWN_PART_KINDS` の直後に判定を1本置く。

```ts
/**
 * オーバレイ由来の part を採用してよいかの判定。
 *
 * kind の許可リストに加えて、source は blockId が無いと何も描けない
 * （指す先を持たない部品が黙って空の表層になる）ので、ここで落とす。
 */
function isUsablePart(p: SpreadPart): boolean {
  if (!KNOWN_PART_KINDS.has(p.kind)) return false
  if (p.kind === 'source') return typeof p.blockId === 'string' && p.blockId.trim() !== ''
  return true
}
```

`sanitizeOverlay` の3か所（`parts` の `if (!KNOWN_PART_KINDS.has(part.kind)) continue`、`extraParts` の `list.filter((p) => KNOWN_PART_KINDS.has(p.kind))`、`topParts` の同じ filter）を `isUsablePart` に差し替える。

- [ ] **Step 5: 網羅の switch を2つ埋める**

`verbatimTargets` の `collect` に足す（`case 'none':` の直前）。

```ts
      case 'source':
        // 原本のブロックを指すだけで文字列を持たない。原本そのものなので照合の必要が無い。
        break
```

`src/lib/spread-namings.ts` の `collectNamings` にも同じ位置に足す。

```ts
    case 'source':
      // 表示上の命名を持たない（原本のブロックをそのまま出す）。
      break
```

- [ ] **Step 6: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts
```

新しい2件が PASS し、既存が全部 PASS すること。

- [ ] **Step 7: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/spread-namings.ts src/lib/__tests__/reader-spread.test.ts
git commit -m "feat(spread): 原本の表・図を指すだけの source 部品を足す

中身を写さずブロックIDだけを持つ。逐語検査の対象は無い。"
```

---

### Task 2: 表層に上げたブロックを深掘りから除く

**Files:**
- Modify: `src/lib/reader-spread.ts:726` 付近（`sectionDisplay`）
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: Task 1 の `{ kind: 'source'; blockId: string }`
- Produces: `sectionDisplay(section).deep` から、`source` が指すブロックが消える

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('sectionDisplay（source が指すブロックの取り分け）', () => {
  const table: ReaderBlock = { kind: 'table', rows: [[t('A'), t('B')]], blockId: 'blk-t' }
  const img: ReaderBlock = { kind: 'image', url: 'https://example.org/a.png', caption: '図1', blockId: 'blk-i' }
  const para: ReaderBlock = { kind: 'paragraph', inlines: t('本文。'), blockId: 'blk-p' }

  it('主役と追加が指したブロックを深掘りから除く', () => {
    const view = sectionDisplay({
      n: 1, anchor: 'sec-1', title: '1. 節', shortLabel: null,
      part: { kind: 'source', blockId: 'blk-t' },
      extraParts: [{ kind: 'source', blockId: 'blk-i' }],
      deep: [table, img, para],
    })
    expect(view.deep).toEqual([para])
  })

  it('指していないブロックは残る', () => {
    const view = sectionDisplay({
      n: 1, anchor: 'sec-1', title: '1. 節', shortLabel: null,
      part: { kind: 'source', blockId: 'blk-i' },
      deep: [table, img, para],
    })
    expect(view.deep).toEqual([table, para])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts -t 'sectionDisplay（source'
```

1件目が「深掘りに table と image が残っている」で落ちること。

- [ ] **Step 3: 実装する**

`sectionDisplay` の `let deep = section.deep` と `const part = section.part` の直後、`dropTable` の定義より前に置く。

```ts
  // source が指したブロックは表層に出るので、深掘りからは除く（同じものが2回出ないように）。
  // 主役だけでなく追加の部品も見る。表を主役に上げたときの dropTable と同じ思想だが、
  // あちらは中身の一致で探すのに対し、こちらはブロックIDで直接引ける。
  const sourceIds = new Set(
    [part, ...(section.extraParts ?? [])].flatMap((p) => (p.kind === 'source' ? [p.blockId] : [])),
  )
  if (sourceIds.size > 0) deep = deep.filter((b) => !(b.blockId && sourceIds.has(b.blockId)))
```

- [ ] **Step 4: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts
```

全部 PASS すること。

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/__tests__/reader-spread.test.ts
git commit -m "feat(spread): source が指したブロックを深掘りから除く"
```

---

### Task 3: 指す先を失った source で保存を止める

**Files:**
- Modify: `src/lib/reader-spread.ts`（`danglingSourceParts` を新設。`refLinkage` の近くに置く）
- Modify: `src/app/api/admin/spread/route.ts:96` 付近（refs の関門の直後）
- Modify: `src/app/admin/spread-edit/SpreadEditClient.tsx`（`built` / `blocked` / エラー文言 / 赤表示）
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: Task 1 の `source` 部品
- Produces: `danglingSourceParts(spread: SpreadDoc): string[]` （指す先が節の深掘りに無い `source` の blockId を、節の順・部品の順で返す）

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('danglingSourceParts（指す先を失った source）', () => {
  const base = { n: 1 as number | null, anchor: 'sec-1', title: '1. 節', shortLabel: null }
  const spreadWith = (part: SpreadPart, deep: ReaderBlock[]): SpreadDoc => ({
    version: 1, pageId: 'p', title: 'x', lead: null, preface: [],
    sections: [{ ...base, part, deep }], tail: [], quizzes: [], icons: {},
  })

  it('指す先が深掘りにあれば空を返す', () => {
    const table: ReaderBlock = { kind: 'table', rows: [[t('A')]], blockId: 'blk-t' }
    expect(danglingSourceParts(spreadWith({ kind: 'source', blockId: 'blk-t' }, [table]))).toEqual([])
  })

  it('指す先が消えていたら blockId を返す', () => {
    const para: ReaderBlock = { kind: 'paragraph', inlines: t('本文。'), blockId: 'blk-p' }
    expect(danglingSourceParts(spreadWith({ kind: 'source', blockId: 'blk-t' }, [para]))).toEqual(['blk-t'])
  })

  it('source を使っていないスプレッドは空を返す（従来の投入を止めない）', () => {
    expect(danglingSourceParts(spreadWith({ kind: 'none' }, []))).toEqual([])
  })
})
```

`SpreadDoc` 型が import 済みか確かめ、無ければ足す。

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts -t 'danglingSourceParts'
```

`danglingSourceParts is not a function` で落ちること。

- [ ] **Step 3: 実装する**

`src/lib/reader-spread.ts` の `refLinkage` の定義の直後に置く。

```ts
/**
 * 指す先を失った source 部品の blockId を返す。
 *
 * 原本が書き換わってブロックが消えると、その部品は何も描けない。別のブロックに
 * 当てにいくと読者に違う図を出すので、当てにいかずに保存を止める（参考文献の
 * 「指す先を失った圧縮行」と同じ fail-closed）。
 *
 * source を使っていないスプレッドでは必ず空を返すので、従来の投入は止まらない。
 */
export function danglingSourceParts(spread: SpreadDoc): string[] {
  const out: string[] = []
  for (const s of spread.sections) {
    const ids = new Set(s.deep.flatMap((b) => (b.blockId ? [b.blockId] : [])))
    for (const p of [s.part, ...(s.extraParts ?? [])]) {
      if (p.kind === 'source' && !ids.has(p.blockId)) out.push(p.blockId)
    }
  }
  return out
}
```

- [ ] **Step 4: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/reader-spread.test.ts -t 'danglingSourceParts'
```

3件とも PASS すること。

- [ ] **Step 5: 保存の関門に足す**

`src/app/api/admin/spread/route.ts` の import に `danglingSourceParts` を足し、refs の関門（`if (linkage.dropped.length > 0 || ...)` のブロック）の直後に置く。

```ts
  // 指す先を失った source 部品。原本のブロックが消えると何も描けないので、
  // 圧縮行と同じく当てにいかずに止める。
  const danglingSources = danglingSourceParts(spread)
  if (danglingSources.length > 0) {
    return NextResponse.json({ error: 'source_missing', blockIds: danglingSources }, { status: 400 })
  }
```

- [ ] **Step 6: 編集画面に出す**

`src/app/admin/spread-edit/SpreadEditClient.tsx`。

import に `danglingSourceParts` を足す。`built` の useMemo の `return` を差し替える。

```ts
    const sourcesMissing = danglingSourceParts(spread)
    return { spread: shown, missing: check.missing, refsMissing, refsDangling, sourcesMissing }
```

`blocked` を差し替える。

```ts
  const blocked = !built || built.missing.length > 0 || built.refsMissing.length > 0 || built.refsDangling.length > 0 || built.sourcesMissing.length > 0
```

`save` のエラー分岐に足す（`data.error === 'refs_incomplete' ? ... :` の次の三項に挟む）。

```ts
            : data.error === 'source_missing'
              ? `原本から消えたブロックを指している部品があります: ${(data.blockIds ?? []).join(' / ')}`
```

上部の赤いラベル群（`built.refsDangling.length > 0 &&` の JSX の直後）に足す。

```tsx
          {built && built.sourcesMissing.length > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">原本から消えたブロックを指す部品が {built.sourcesMissing.length} 件</span>
          )}
```

下部の詳細リスト（`built.refsDangling.length > 0 &&` のブロックの直後）に足す。

```tsx
              {built.sourcesMissing.length > 0 && (
                <div className="mb-3 text-sm text-red-600 dark:text-red-400">
                  <p className="font-bold">原本から消えたブロックを指す部品（このままでは保存できません）</p>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {built.sourcesMissing.map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                </div>
              )}
```

- [ ] **Step 7: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

どちらもエラー・失敗が無いこと。

- [ ] **Step 8: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/__tests__/reader-spread.test.ts src/app/api/admin/spread/route.ts src/app/admin/spread-edit/SpreadEditClient.tsx
git commit -m "feat(spread): 指す先を失った source で保存を止める

原本からブロックが消えたら、別のブロックに当てにいかずに止める。
参考文献の圧縮行と同じ fail-closed。"
```

---

### Task 4: `source` 部品を描画する

**Files:**
- Modify: `src/components/reader/spread/ReaderSpread.tsx`（3か所の `<SpreadPartView>` 呼び出しと、その上に置く小さな部品）
- Modify: `src/components/reader/spread/spread.module.css`（余白のクラス1つ）

**Interfaces:**
- Consumes: Task 1 の `source` 部品
- Produces: `SurfacePart`（`ReaderSpread.tsx` の中の非公開コンポーネント。props は `{ part: SpreadPart; blocks: ReaderBlock[]; onImageClick: (url: string) => void }`）

- [ ] **Step 1: 描画の部品を書く**

`ReaderSpread.tsx` の中、`SpreadPartView` を使っている最初の場所より前に置く。

```tsx
/**
 * 表層の部品を1つ描く。
 *
 * source（原本の表・図を指すだけの部品）は本文ブロックそのものなので、表層の見た目を持つ
 * SpreadPartView ではなく、深掘りと同じ RenderedBlocks に1件渡して描く。見た目を1本に
 * 保つためで、表層専用の画像・表の見た目は作らない。
 *
 * blocks は節の deep（sectionDisplay で取り分ける前の保存形）。取り分けた後を渡すと、
 * 昇格したブロックが既に除かれていて何も描けない。
 */
function SurfacePart({ part, blocks, onImageClick }: { part: SpreadPart; blocks: ReaderBlock[]; onImageClick: (url: string) => void }) {
  if (part.kind !== 'source') return <SpreadPartView part={part} />
  const block = blocks.find((b) => b.blockId === part.blockId)
  // 指す先が無いスプレッドは保存の関門で止まる。ここに来るのは保存より前の
  // 編集画面のプレビューだけなので、落ちずに何も出さない。
  if (!block) return null
  return (
    <div className={styles.sourcePart}>
      <RenderedBlocks blocks={[block]} onImageClick={onImageClick} active={NO_FILTER} />
    </div>
  )
}
```

`SpreadPart` と `ReaderBlock` が import 済みか確かめ、無ければ型 import に足す。

- [ ] **Step 2: 3か所の呼び出しを差し替える**

`topParts`（節に属さないので `blocks` は空配列を渡す。`source` は節の中でしか意味を持たない）。

```tsx
            {(spread.topParts ?? []).map((p, pi) => (
              <SurfacePart key={pi} part={p} blocks={[]} onImageClick={onImageClick} />
            ))}
```

節の主役と追加。

```tsx
              <SurfacePart part={s.part} blocks={s.deep} onImageClick={onImageClick} />
              {(s.extraParts ?? []).map((p, pi) => (
                <SurfacePart key={pi} part={p} blocks={s.deep} onImageClick={onImageClick} />
              ))}
```

- [ ] **Step 3: 余白のクラスを足す**

`src/components/reader/spread/spread.module.css` の `.topParts` の定義の直後に足す。

```css
.sourcePart {
  margin: 0 0 1.25rem;
}
```

- [ ] **Step 4: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 5: コミット**

```bash
git add src/components/reader/spread/ReaderSpread.tsx src/components/reader/spread/spread.module.css
git commit -m "feat(spread): source 部品を RenderedBlocks で描く"
```

---

### Task 5: 言い換えた文の逃げ道を、全部の欄に配線する

**Files:**
- Modify: `src/app/admin/spread-edit/OverlayBuilder.tsx`（`InlinesEditor` / `PartForm` / `SectionEditor` / `RefsEditor` / `OverlayBuilder` の props）

**Interfaces:**
- Consumes: `onAddToNotes?: (text: string) => Promise<void>`（`SpreadEditClient` が既に渡している）
- Produces: `InlinesEditor` が `onAddToNotes` を受け取り、赤枠のときにボタンを出す

- [ ] **Step 1: `InlinesEditor` にボタンを足す**

props に `onAddToNotes?: (text: string) => Promise<void>` を足し、`const [adding, setAdding] = useState(false)` を関数の先頭に置く。最後の `{bad && <span ...>原本にもスプレッドノートにも無い文です</span>}` の直後に足す。

```tsx
        {bad && onAddToNotes && (
          <button
            type="button"
            disabled={adding}
            onClick={async () => {
              setAdding(true)
              try {
                await onAddToNotes(text.trim())
              } finally {
                setAdding(false)
              }
            }}
            className="text-[11px] rounded-full border border-brand-600 text-brand-700 dark:text-brand-300 px-2 py-0.5 disabled:opacity-40"
          >
            {adding ? '追加中…' : 'この文をスプレッドノートに追加'}
          </button>
        )}
```

送るのは文節ごとではなく `text`（つないだ文全体）。逐語照合の単位が連結テキストのため、文節単位で足しても赤は消えない。

- [ ] **Step 2: `PartForm` から下へ通す**

`PartForm` の props に `onAddToNotes?: (text: string) => Promise<void>` を足し、`common` に入れる。

```ts
function PartForm({ part, onChange, checker, own, notes, onAddToNotes }: { part: SpreadPart; onChange: (p: SpreadPart) => void; checker: Checker; own: string[]; notes: string[]; onAddToNotes?: (text: string) => Promise<void> }) {
  const common = { checker, own, notes, onAddToNotes }
```

`common` は `InlinesEditor` に `{...common}` で渡っているので、これで全ての文の欄に届く。`VerbatimInput` を直接呼んでいる箇所（`LinesEditor` を経由しない欄）にも `onAddToNotes={onAddToNotes}` を渡す。

`LinesEditor` の props にも `onAddToNotes` を足し、中の `InlinesEditor` に渡す。

- [ ] **Step 3: `SectionEditor` から下へ通す**

`SectionEditor` の props に `onAddToNotes` を足し、`partBlock` の中の `<PartForm ... />` に渡す。

- [ ] **Step 4: `RefsEditor` に通す**

`RefsEditor` の props に `onAddToNotes` を足し、中の `VerbatimInput` 全部に渡す。

- [ ] **Step 5: `OverlayBuilder` から配る**

`<SectionEditor ... onAddToNotes={onAddToNotes} />` と `<RefsEditor ... onAddToNotes={onAddToNotes} />` に渡す。

- [ ] **Step 6: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 7: 手で確かめる**

`npm run dev` は使わず、`.claude/launch.json` の設定でプレビューを起動して `/admin/spread-edit?pageId=<記事のID>` を開く。節の部品の文の欄に原本に無い文を打ち、赤枠の横に「この文をスプレッドノートに追加」が出ることと、押すと赤が消えることを確かめる。

- [ ] **Step 8: コミット**

```bash
git add src/app/admin/spread-edit/OverlayBuilder.tsx
git commit -m "feat(spread): 言い換えた文の逃げ道を節の部品と参考文献の欄にも出す

逐語検査そのものは変えない。書いた文が非公開ノートに残る性質も保つ。"
```

---

### Task 6: 主役を含めて節の中で並べ替える

**Files:**
- Modify: `src/lib/spread-edit.ts`（`swapMainWithFirstExtra` を新設）
- Modify: `src/app/admin/spread-edit/OverlayBuilder.tsx`（`SectionEditor` の `partBlock`）
- Test: `src/lib/__tests__/spread-edit.test.ts`

このリポジトリにReactコンポーネントのテストは無い（`@testing-library` を入れていない）。
入れ替えの判断はテストで固定したいので、**オーバレイを受けてオーバレイを返す純関数に切り出してから**画面につなぐ。

**Interfaces:**
- Consumes: `overlay.parts[anchor]`（主役・未設定なら自動判定）と `overlay.extraParts[anchor]`（配列）
- Produces: `swapMainWithFirstExtra(overlay: SpreadOverlay, anchor: string): SpreadOverlay`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/spread-edit.test.ts` の末尾に足す。

```ts
describe('swapMainWithFirstExtra（主役と追加の先頭の入れ替え）', () => {
  const note: SpreadPart = { kind: 'note', inlines: [{ text: '主役' }] }
  const big: SpreadPart = { kind: 'bignumber', value: '9.1%', caption: [] }
  const gauge: SpreadPart = { kind: 'gauge', items: [{ value: '1', label: [] }] }

  it('主役と追加の先頭を入れ替え、残りの追加の並びは保つ', () => {
    const out = swapMainWithFirstExtra(
      { parts: { 'sec-1': note }, extraParts: { 'sec-1': [big, gauge] } },
      'sec-1',
    )
    expect(out.parts?.['sec-1']).toEqual(big)
    expect(out.extraParts?.['sec-1']).toEqual([note, gauge])
  })

  it('主役が自動判定（parts に無い）のときは何も変えない', () => {
    const before: SpreadOverlay = { extraParts: { 'sec-1': [big] } }
    expect(swapMainWithFirstExtra(before, 'sec-1')).toEqual(before)
  })

  it('追加が無いときは何も変えない', () => {
    const before: SpreadOverlay = { parts: { 'sec-1': note } }
    expect(swapMainWithFirstExtra(before, 'sec-1')).toEqual(before)
  })

  it('他の節のオーバレイに触らない', () => {
    const out = swapMainWithFirstExtra(
      { parts: { 'sec-1': note, 'sec-2': gauge }, extraParts: { 'sec-1': [big] } },
      'sec-1',
    )
    expect(out.parts?.['sec-2']).toEqual(gauge)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts -t 'swapMainWithFirstExtra'
```

`swapMainWithFirstExtra is not a function` で落ちること。

- [ ] **Step 3: 実装する**

`src/lib/spread-edit.ts` の末尾に足す。

```ts
/**
 * 節の主役と、追加の先頭を入れ替える。
 *
 * 画面では主役と追加を1本の並びとして扱うが、保存の形は「主役1つ＋追加の配列」のままなので、
 * 並びをまたぐこの1手だけを別に持つ。
 *
 * 主役が自動判定（parts に無い）のときは何もしない。降ろすには原本の表の中身をオーバレイに
 * 写すことになり、原本を直したときに黙って古くなるため。呼ぶ側はボタンを無効にして、
 * 効かない理由を画面に出すこと。
 */
export function swapMainWithFirstExtra(overlay: SpreadOverlay, anchor: string): SpreadOverlay {
  const main = overlay.parts?.[anchor]
  const extras = overlay.extraParts?.[anchor] ?? []
  if (!main || extras.length === 0) return overlay
  return {
    ...overlay,
    parts: { ...(overlay.parts ?? {}), [anchor]: extras[0] },
    extraParts: { ...(overlay.extraParts ?? {}), [anchor]: [main, ...extras.slice(1)] },
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts -t 'swapMainWithFirstExtra'
```

4件とも PASS すること。

- [ ] **Step 5: 主役に下ボタンを足す**

`OverlayBuilder.tsx` の import に `swapMainWithFirstExtra` を足す。`SectionEditor` の中、`partBlock` の定義より前に置く。

```ts
  const swapMain = () => onChange(swapMainWithFirstExtra(overlay, sec.anchor))
```

`partBlock` の `{slot !== 'main' && (...)}` のブロックの前に足す。

```tsx
        {slot === 'main' && (
          <IconButton title="下へ（追加の先頭と入れ替える）" onClick={swapMain} disabled={extras.length === 0}>
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
          </IconButton>
        )}
```

- [ ] **Step 6: 追加の先頭の上ボタンを主役との交換にする**

`slot !== 'main'` のブロックの「上へ」を差し替える。

```tsx
            <IconButton
              title={slot === 0 && !main ? '先に主役を置き換えてください（原本の表は降ろせません）' : '上へ'}
              onClick={() => {
                if (slot === 0) { swapMain(); return }
                const n = [...extras]; const i = slot as number
                const [x] = n.splice(i, 1); n.splice(i - 1, 0, x); setExtras(n)
              }}
              disabled={slot === 0 && !main}
            >
              <ChevronUp className="w-3.5 h-3.5" aria-hidden />
            </IconButton>
```

- [ ] **Step 7: 効かない理由を1行出す**

`partBlock` の `<PartForm ... />` の直前に足す。

```tsx
      {slot === 0 && !main && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
          主役が自動判定のままなので、ここより上へは動かせません。先に主役を置き換えてください。
        </p>
      )}
```

- [ ] **Step 8: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 9: 手で確かめる**

プレビューで、主役を「補足ノート」に置き換えてある節の追加部品で「上へ」を押し、主役と入れ替わることを確かめる。主役が自動判定のままの節では上ボタンが無効で、理由の1行が出ることを確かめる。

- [ ] **Step 10: コミット**

```bash
git add src/lib/spread-edit.ts src/lib/__tests__/spread-edit.test.ts src/app/admin/spread-edit/OverlayBuilder.tsx
git commit -m "feat(spread): 主役を含めて節の中の部品を並べ替えられるようにする"
```

---

### Task 7: 原本の表・図を選ぶUI

**Files:**
- Create: `src/app/admin/spread-edit/SourcePicker.tsx`
- Modify: `src/app/admin/spread-edit/OverlayBuilder.tsx`（`KIND_LABEL` / `ADDABLE` / `PartForm` / `emptyPart` の呼び出し）
- Modify: `src/lib/spread-edit.ts`（`emptyPart`）
- Test: `src/lib/__tests__/spread-edit.test.ts`

**Interfaces:**
- Consumes: Task 1 の `source` 部品、`SectionInfo.deep`
- Produces: `sourceCandidates(deep: ReaderBlock[]): { blockId: string; label: string }[]`（`src/lib/spread-edit.ts`）。`SourcePicker`（props は `{ deep: ReaderBlock[]; value: string; onChange: (blockId: string) => void }`）

- [ ] **Step 1: 候補を作る関数の失敗するテストを書く**

`src/lib/__tests__/spread-edit.test.ts` の末尾に足す。

```ts
describe('sourceCandidates（表層に上げられる原本のブロック）', () => {
  it('表と画像だけを、登場順に、見分けの付く名前で返す', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'paragraph', inlines: t('本文。'), blockId: 'blk-p' },
      { kind: 'table', rows: [[t('NIV群'), t('酸素マスク群')], [t('9.1%'), t('18.5%')]], blockId: 'blk-t' },
      { kind: 'image', url: 'https://example.org/a.png', caption: '低酸素血症の発生率', blockId: 'blk-i' },
      { kind: 'image', url: 'https://example.org/b.png', caption: null, blockId: 'blk-i2' },
      { kind: 'table', rows: [[t('マスク種類')]], blockId: 'blk-t2' },
    ]
    expect(sourceCandidates(blocks)).toEqual([
      { blockId: 'blk-t', label: '表: NIV群／酸素マスク群' },
      { blockId: 'blk-i', label: '図: 低酸素血症の発生率' },
      { blockId: 'blk-i2', label: '図: 2つ目' },
      { blockId: 'blk-t2', label: '表: マスク種類' },
    ])
  })

  it('ブロックIDを持たないブロックは候補にしない（指す先にできないため）', () => {
    const blocks: ReaderBlock[] = [{ kind: 'table', rows: [[t('A')]] }]
    expect(sourceCandidates(blocks)).toEqual([])
  })
})
```

`sourceCandidates` を import に足す。

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts -t 'sourceCandidates'
```

`sourceCandidates is not a function` で落ちること。

- [ ] **Step 3: 実装する**

`src/lib/spread-edit.ts` の末尾に足す（`textOf` と `ReaderBlock` は既に import されている）。

```ts
/**
 * その節で表層に上げられる原本のブロック（表と画像）を、登場順に返す。
 *
 * 名前は見分けが付けばよいので、表は先頭行のセル、画像はキャプションから作る。
 * キャプションの無い画像は「図: N つ目」で数える（同じ名前が並ぶと選べないため）。
 * ブロックIDを持たないブロックは、指す先にできないので候補から外す。
 */
export function sourceCandidates(deep: ReaderBlock[]): { blockId: string; label: string }[] {
  const out: { blockId: string; label: string }[] = []
  let images = 0
  for (const b of deep) {
    if (b.kind === 'image') {
      images += 1
      if (!b.blockId) continue
      out.push({ blockId: b.blockId, label: `図: ${b.caption?.trim() || `${images}つ目`}` })
      continue
    }
    if (b.kind !== 'table' || !b.blockId) continue
    const head = (b.rows[0] ?? []).map((cell) => textOf(cell).trim()).filter(Boolean).join('／')
    out.push({ blockId: b.blockId, label: `表: ${head || '見出しなし'}` })
  }
  return out
}
```

- [ ] **Step 4: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts
```

- [ ] **Step 5: `emptyPart` に `source` を足す**

`src/lib/spread-edit.ts` の `emptyPart` の switch に足す。

```ts
    case 'source':
      return { kind: 'source', blockId: '' }
```

`emptyPart` の返り値は `sanitizeOverlay` を通ると落ちるが（blockId が空）、これは編集中の未選択の状態であり、選ぶまで保存に出ないことが正しい。

- [ ] **Step 6: `SourcePicker` を書く**

`src/app/admin/spread-edit/SourcePicker.tsx` を作る。

```tsx
'use client'

// 節の中の表・画像から1つ選ぶ。選んだ結果として保存されるのは原本のブロックIDだけで、
// 中身は写さない（原本を直せば表層も追いつく）。
import type { ReaderBlock } from '@/lib/reader-doc'
import { sourceCandidates } from '@/lib/spread-edit'

export function SourcePicker({ deep, value, onChange }: { deep: ReaderBlock[]; value: string; onChange: (blockId: string) => void }) {
  const items = sourceCandidates(deep)
  if (items.length === 0) {
    return <p className="text-[11px] text-gray-400 dark:text-gray-500">この節の原本に、表も図もありません。</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it.blockId}
          type="button"
          onClick={() => onChange(it.blockId)}
          className={`text-[11px] rounded-full border px-2.5 py-1 ${
            it.blockId === value
              ? 'border-brand-600 bg-brand-50 dark:bg-white/10 text-brand-700 dark:text-brand-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: 編集画面につなぐ**

`OverlayBuilder.tsx`。import に `SourcePicker` を足す。

`KIND_LABEL` に足す。

```ts
  source: '原本の表・図',
```

`ADDABLE` に足す。

```ts
const ADDABLE: SpreadPart['kind'][] = ['flow', 'cards', 'gonogo', 'gauge', 'note', 'bignumber', 'source']
```

`PartForm` の props に `deep: ReaderBlock[]` を足し、`comparison / matrix / none` の最後の return より前に足す。

```tsx
  if (part.kind === 'source') {
    return (
      <Field label="この節の原本から選ぶ（中身は写さず、原本を直せば追いつきます）">
        <SourcePicker deep={deep} value={part.blockId} onChange={(blockId) => onChange({ ...part, blockId })} />
      </Field>
    )
  }
```

`SectionEditor` の `partBlock` の `<PartForm ... />` に `deep={sec.deep}` を渡す。`ReaderBlock` 型が import 済みか確かめる。

- [ ] **Step 8: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 9: 手で確かめる**

プレビューで、表が2つある節に「原本の表・図」を追加し、2つ目の表を選ぶ。右のプレビューでその表が表層に出て、折りたたみの中からは消えていることを確かめる。

- [ ] **Step 10: コミット**

```bash
git add src/lib/spread-edit.ts src/lib/__tests__/spread-edit.test.ts src/app/admin/spread-edit/SourcePicker.tsx src/app/admin/spread-edit/OverlayBuilder.tsx
git commit -m "feat(spread): 各節の原本の表・図を選んで表層に出せるようにする"
```

---

### Task 8: 表に出るものの一覧と「未決 N節」

**Files:**
- Create: `src/app/admin/spread-edit/SurfaceChecklist.tsx`
- Modify: `src/app/admin/spread-edit/OverlayBuilder.tsx`（一覧を先頭に置く。`KIND_LABEL` を export する）
- Modify: `src/app/admin/spread-edit/SpreadEditClient.tsx`（保存ボタンの横に「未決 N節」）
- Modify: `src/lib/spread-edit.ts`（`undecidedAnchors`）
- Test: `src/lib/__tests__/spread-edit.test.ts`

**Interfaces:**
- Consumes: `overlay.parts`、Task 7 の `sourceCandidates`
- Produces: `undecidedAnchors(anchors: string[], overlay: SpreadOverlay): string[]`（主役をまだ決めていない節のアンカー）

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('undecidedAnchors（主役をまだ決めていない節）', () => {
  it('parts に無い節だけを返す。表層なしを選んだ節は決定ずみ', () => {
    const overlay: SpreadOverlay = {
      parts: { 'sec-1': { kind: 'note', inlines: [{ text: 'x' }] }, 'sec-2': { kind: 'none' } },
    }
    expect(undecidedAnchors(['sec-1', 'sec-2', 'sec-3'], overlay)).toEqual(['sec-3'])
  })

  it('オーバレイが空なら全部が未決', () => {
    expect(undecidedAnchors(['sec-1', 'sec-2'], {})).toEqual(['sec-1', 'sec-2'])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts -t 'undecidedAnchors'
```

- [ ] **Step 3: 実装する**

`src/lib/spread-edit.ts` に足す。

```ts
/**
 * 主役の部品をまだ決めていない節を返す。
 *
 * 「未決」は間違いではなく手つかず。逐語一致と文献の紐づけは間違いが読者に出るので
 * 保存を止めるが、こちらは数を出すだけで止めない（既存の記事はほとんどの節が
 * 自動判定のままなので、止めるとその場で保存できなくなる）。
 * 「表層なしにする」を選んだ節（kind: 'none'）は決定ずみとして数えない。
 */
export function undecidedAnchors(anchors: string[], overlay: SpreadOverlay): string[] {
  return anchors.filter((a) => !overlay.parts?.[a])
}
```

`SpreadOverlay` は既に import されている。

- [ ] **Step 4: テストが通ることを確かめる**

```bash
npx vitest run src/lib/__tests__/spread-edit.test.ts
```

- [ ] **Step 5: 一覧を書く**

`src/app/admin/spread-edit/SurfaceChecklist.tsx` を作る。

```tsx
'use client'

// 表に出るものの一覧。節を開かずに読めるのは表層だけなので、そこに何を置いたかを
// 節ごとに1回ずつ通すための場所。未決＝主役をまだ決めていない節で、これは間違いでは
// ないので保存は止めない（数を出すだけ）。
import type { SpreadOverlay, SpreadPart } from '@/lib/reader-spread'
import { sourceCandidates } from '@/lib/spread-edit'
import type { ReaderBlock } from '@/lib/reader-doc'

type Row = { anchor: string; n: number | null; title: string; deep: ReaderBlock[]; autoKind: SpreadPart['kind'] }

export function SurfaceChecklist({
  rows,
  overlay,
  kindLabel,
  onPickSource,
  onNone,
}: {
  rows: Row[]
  overlay: SpreadOverlay
  kindLabel: Record<string, string>
  onPickSource: (anchor: string, blockId: string) => void
  onNone: (anchor: string) => void
}) {
  return (
    <div className="mb-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs font-bold">表に出すものを決める</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          節を開かずに読めるのはここだけです。細かい数値と原文の主張は折りたたみに残ります。
        </p>
      </div>
      {rows.map((r) => {
        const main = overlay.parts?.[r.anchor]
        const extras = overlay.extraParts?.[r.anchor] ?? []
        const undecided = !main
        const shown = main
          ? [main, ...extras].map((p) => kindLabel[p.kind] ?? p.kind).join(' ＋ ')
          : `自動判定のまま（${kindLabel[r.autoKind] ?? r.autoKind}）`
        return (
          <div
            key={r.anchor}
            className={`flex gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${undecided ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}
          >
            <span className="w-5 h-5 shrink-0 rounded-full bg-brand-600 text-white text-[11px] font-bold inline-flex items-center justify-center">
              {r.n ?? '-'}
            </span>
            <div className="flex-1 min-w-0">
              <a href={`#edit-${r.anchor}`} className="text-xs font-bold block truncate">{r.title}</a>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{shown}</p>
              {undecided && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                  {sourceCandidates(r.deep).map((c) => (
                    <button
                      key={c.blockId}
                      type="button"
                      onClick={() => onPickSource(r.anchor, c.blockId)}
                      className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 px-2.5 py-1"
                    >
                      {c.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onNone(r.anchor)}
                    className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 px-2.5 py-1"
                  >
                    表層なしで確定
                  </button>
                </div>
              )}
            </div>
            <span
              className={`self-start text-[10px] px-1.5 py-0.5 rounded ${undecided ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' : 'bg-brand-50 dark:bg-white/10 text-brand-700 dark:text-brand-300'}`}
            >
              {undecided ? '未決' : '決定ずみ'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: `OverlayBuilder` に置く**

`KIND_LABEL` を export する（`export const KIND_LABEL`）。`SectionEditor` の一番外の `<div className="mb-4">` に `id={`edit-${sec.anchor}`}` を足す（一覧からの飛び先）。

`OverlayBuilder` の return の先頭に置く。

```tsx
      <SurfaceChecklist
        rows={sections.map((s) => ({ anchor: s.anchor, n: s.n, title: sectionTitleText(s), deep: s.deep, autoKind: s.autoKind }))}
        overlay={overlay}
        kindLabel={KIND_LABEL}
        onPickSource={(anchor, blockId) =>
          onChange({ ...overlay, parts: { ...(overlay.parts ?? {}), [anchor]: { kind: 'source', blockId } } })
        }
        onNone={(anchor) => onChange({ ...overlay, parts: { ...(overlay.parts ?? {}), [anchor]: { kind: 'none' } } })}
      />
```

- [ ] **Step 7: 保存ボタンの横に数を出す**

`SpreadEditClient.tsx`。import に `undecidedAnchors` を足し、`built` の useMemo の中で数える。

```ts
    const undecided = undecidedAnchors(spread.sections.map((s) => s.anchor), overlay)
    return { spread: shown, missing: check.missing, refsMissing, refsDangling, sourcesMissing, undecided }
```

`blocked` は**変えない**（未決では止めない）。赤いラベル群の末尾に足す。

```tsx
          {built && built.undecided.length > 0 && (
            <span className="text-xs text-amber-700 dark:text-amber-400">未決 {built.undecided.length}節</span>
          )}
```

- [ ] **Step 8: 型検査とテストを通す**

```bash
npx tsc --noEmit && npm test
```

- [ ] **Step 9: 手で確かめる**

プレビューで、一覧が編集画面の先頭に出ること、未決の節が黄色で出ること、候補ボタンを押すとその節の主役が決まって「決定ずみ」に変わること、「表層なしで確定」でも決定ずみになること、未決が残っていても保存できることを確かめる。

- [ ] **Step 10: コミット**

```bash
git add src/lib/spread-edit.ts src/lib/__tests__/spread-edit.test.ts src/app/admin/spread-edit/SurfaceChecklist.tsx src/app/admin/spread-edit/OverlayBuilder.tsx src/app/admin/spread-edit/SpreadEditClient.tsx
git commit -m "feat(spread): 表に出るものの一覧を編集画面の先頭に常設する

未決は間違いではないので保存は止めず、数だけ出す。"
```

---

## 仕上げ

- [ ] `npm test` が全部通ることを確かめる
- [ ] `npx tsc --noEmit` が通ることを確かめる
- [ ] `npm run build` が通ることを確かめる
- [ ] superpowers:requesting-code-review でレビューを取る
- [ ] superpowers:finishing-a-development-branch でマージの形を決める
