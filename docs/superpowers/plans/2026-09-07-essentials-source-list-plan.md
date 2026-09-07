# Essentials の出典一覧と段階8色 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` の Essentials タブに台帳63件の一覧（絞り込み・並び替え・誌の内訳）を足し、段階の色を検証済みの8色にする。

**Architecture:** 絞り込み・並び替え・誌の内訳は `essentials-admin.ts` の純関数にしてテストで固定し、画面はその結果を描くだけにする。APIは変えない（`/api/admin/essentials` はすでに台帳の全行を返している）。

**Tech Stack:** Next.js 16 / React 18 / TypeScript / Tailwind / vitest

## Global Constraints

- 設計書は `docs/superpowers/specs/2026-09-07-essentials-source-list-design.md`。
- **公開リポジトリ**。実データの文献名・誌名・件数をコードやテストの固定値に書かない（テストは `文献A` のような架空の名前を使う）。
- 誌名の名寄せをしない。件数を並べるところまで。
- 色は設計書の表の値をそのまま使う（配色検証を通した値。勝手に足さない・変えない）。
- テスト: `npx vitest run <path>`、最後に `npm test`。コミットはタスクごと（末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`）。push は承認を取ってから。

---

### Task 1: 出典の絞り込み・並び替え・誌の内訳（純関数）

**Files:**
- Modify: `src/lib/essentials-admin.ts`
- Modify: `src/lib/__tests__/essentials-admin.test.ts`

**Interfaces:**
- Consumes: `EssentialsSource`（既存）
- Produces:
  - `type SourceFilter = { state: string; role: string; owner: string; q: string }`
  - `type SourceSort = 'year-desc' | 'year-asc' | 'role' | 'journal'`
  - `filterSources(sources: EssentialsSource[], f: SourceFilter): EssentialsSource[]`
  - `sortSources(sources: EssentialsSource[], sort: SourceSort): EssentialsSource[]`
  - `journalCounts(sources: EssentialsSource[], top: number): { top: { journal: string; count: number }[]; otherCount: number }`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/essentials-admin.test.ts` の import に `filterSources`・`sortSources`・`journalCounts`・`type SourceFilter` を足し、末尾に:

```ts
describe('出典の絞り込みと並び替え', () => {
  const src = (over: Partial<EssentialsSource>): EssentialsSource => ({
    id: 'x', url: 'https://www.notion.so/x', name: '文献A', state: '全文', owner: 'Claude取得可',
    role: '主要RCT', year: 2020, journal: '誌A', key: '', link: null, topicIds: [],
    wall: '', route: '', claim: '', file: '', checkedAt: null, ...over,
  })
  const NONE: SourceFilter = { state: '', role: '', owner: '', q: '' }

  it('絞り込みが空なら全件返す', () => {
    const list = [src({ id: 'a' }), src({ id: 'b' })]
    expect(filterSources(list, NONE)).toHaveLength(2)
  })

  it('状態・役割・誰が取るかで絞る', () => {
    const list = [
      src({ id: 'a', state: '全文', role: 'ガイドライン', owner: 'Claude取得可' }),
      src({ id: 'b', state: '未取得', role: '主要RCT', owner: '要手動' }),
    ]
    expect(filterSources(list, { ...NONE, state: '未取得' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSources(list, { ...NONE, role: 'ガイドライン' }).map((s) => s.id)).toEqual(['a'])
    expect(filterSources(list, { ...NONE, owner: '要手動' }).map((s) => s.id)).toEqual(['b'])
  })

  it('キーワードは文献名と誌の両方を見る（大文字小文字を区別しない）', () => {
    const list = [
      src({ id: 'a', name: '文献A', journal: '誌X' }),
      src({ id: 'b', name: 'Sepsis trial', journal: '誌Y' }),
    ]
    expect(filterSources(list, { ...NONE, q: 'sepsis' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSources(list, { ...NONE, q: '誌X' }).map((s) => s.id)).toEqual(['a'])
  })

  it('絞り込みは掛け合わせる', () => {
    const list = [
      src({ id: 'a', state: '全文', role: 'ガイドライン' }),
      src({ id: 'b', state: '全文', role: '主要RCT' }),
    ]
    expect(filterSources(list, { ...NONE, state: '全文', role: '主要RCT' }).map((s) => s.id)).toEqual(['b'])
  })

  it('年で並べる。年が無い行は末尾に置く', () => {
    const list = [src({ id: 'a', year: 2018 }), src({ id: 'b', year: null }), src({ id: 'c', year: 2024 })]
    expect(sortSources(list, 'year-desc').map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(sortSources(list, 'year-asc').map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('役割は背骨が先（SOURCE_ROLE_ORDER の順）', () => {
    const list = [src({ id: 'a', role: '総説' }), src({ id: 'b', role: 'ガイドライン' })]
    expect(sortSources(list, 'role').map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('誌は名前順。同じ誌なら年の新しい順', () => {
    const list = [
      src({ id: 'a', journal: '誌B', year: 2020 }),
      src({ id: 'b', journal: '誌A', year: 2010 }),
      src({ id: 'c', journal: '誌A', year: 2022 }),
    ]
    expect(sortSources(list, 'journal').map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('並び替えは元の配列を変えない', () => {
    const list = [src({ id: 'a', year: 2018 }), src({ id: 'b', year: 2024 })]
    sortSources(list, 'year-desc')
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('誌の内訳', () => {
  const src = (journal: string, i: number): EssentialsSource => ({
    id: `s${i}`, url: '', name: `文献${i}`, state: '全文', owner: '', role: '', year: null,
    journal, key: '', link: null, topicIds: [], wall: '', route: '', claim: '', file: '', checkedAt: null,
  })

  it('件数の多い順に上位を返し、残りをその他に足す', () => {
    const list = [src('誌A', 1), src('誌A', 2), src('誌A', 3), src('誌B', 4), src('誌B', 5), src('誌C', 6)]
    expect(journalCounts(list, 2)).toEqual({
      top: [{ journal: '誌A', count: 3 }, { journal: '誌B', count: 2 }],
      otherCount: 1,
    })
  })

  it('件数が同じなら誌名の順', () => {
    const list = [src('誌B', 1), src('誌A', 2)]
    expect(journalCounts(list, 2).top.map((t) => t.journal)).toEqual(['誌A', '誌B'])
  })

  it('誌が空の行は数えない', () => {
    expect(journalCounts([src('', 1), src('誌A', 2)], 5)).toEqual({ top: [{ journal: '誌A', count: 1 }], otherCount: 0 })
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts`
Expected: FAIL（`filterSources is not a function`）

- [ ] **Step 3: 純関数を書く**

`src/lib/essentials-admin.ts` の `fetchQueue` の下に足す:

```ts
// ---- 出典の一覧（/admin Essentials タブの「出典の一覧」） -------------------------

export type SourceFilter = { state: string; role: string; owner: string; q: string }
export type SourceSort = 'year-desc' | 'year-asc' | 'role' | 'journal'

/** 空の条件は素通し。キーワードは文献名と誌の部分一致（大文字小文字を区別しない）。 */
export function filterSources(sources: EssentialsSource[], f: SourceFilter): EssentialsSource[] {
  const needle = f.q.trim().toLowerCase()
  return sources.filter(
    (s) =>
      (!f.state || s.state === f.state) &&
      (!f.role || s.role === f.role) &&
      (!f.owner || s.owner === f.owner) &&
      (!needle || s.name.toLowerCase().includes(needle) || s.journal.toLowerCase().includes(needle)),
  )
}

// 年が無い行は、どちらの向きでも末尾に置く（年で並べたときに先頭を占めないため）。
function yearRank(year: number | null, desc: boolean): number {
  if (year === null) return desc ? -Infinity : Infinity
  return year
}

export function sortSources(sources: EssentialsSource[], sort: SourceSort): EssentialsSource[] {
  const list = [...sources]
  if (sort === 'year-desc') return list.sort((a, b) => yearRank(b.year, true) - yearRank(a.year, true) || a.name.localeCompare(b.name, 'ja'))
  if (sort === 'year-asc') return list.sort((a, b) => yearRank(a.year, false) - yearRank(b.year, false) || a.name.localeCompare(b.name, 'ja'))
  if (sort === 'role') return list.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (b.year ?? 0) - (a.year ?? 0))
  return list.sort((a, b) => a.journal.localeCompare(b.journal, 'ja') || (b.year ?? 0) - (a.year ?? 0))
}

/**
 * 誌ごとの件数（多い順・同数なら誌名順）。上位 top 件と、それ以外の合計を返す。
 *
 * 名寄せはしない。略記と正式名（「NEJM」と「N Engl J Med」）を機械で束ねると別の雑誌を混ぜる。
 * 件数を並べて出すところまでを画面の仕事にし、直すかどうかは Notion 側で人が決める。
 */
export function journalCounts(
  sources: EssentialsSource[],
  top: number,
): { top: { journal: string; count: number }[]; otherCount: number } {
  const counts = new Map<string, number>()
  for (const s of sources) {
    const j = s.journal.trim()
    if (!j) continue
    counts.set(j, (counts.get(j) ?? 0) + 1)
  }
  const all = [...counts.entries()]
    .map(([journal, count]) => ({ journal, count }))
    .sort((a, b) => b.count - a.count || a.journal.localeCompare(b.journal, 'ja'))
  return { top: all.slice(0, top), otherCount: all.slice(top).reduce((n, x) => n + x.count, 0) }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/essentials-admin.ts src/lib/__tests__/essentials-admin.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 出典の絞り込み・並び替え・誌の内訳を純関数にする

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 出典の一覧カードと段階の8色

**Files:**
- Modify: `src/app/admin/EssentialsCard.tsx`

**Interfaces:**
- Consumes: Task 1 の3関数、`EssentialsSource`・`SOURCE_ROLE_ORDER`（既存）
- Produces: 画面のみ

- [ ] **Step 1: 段階の色を差し替える**

`STAGE_STYLE` を設計書の表の値にする（コメントも差し替える）:

```ts
// 段階ごとの色（ライト / ダーク）。SVG の弧は stroke、凡例と帯は bg で同じ色を使う。
//
// 段ごとに色相を変える。1色の濃淡にしていたが、実データでは135主題中128件が「2 収集済」に
// 集まるため、どのリングもほぼ1色になり、進んだ段階の小さな片が埋もれた（2026-09-07 オーナー指摘）。
// 未収集は薄く沈め、完了（スプレッド公開）を緑にする。
// 配色検証を通した値。隣り合う段の見分けはライト normal ΔE 16.7 以上・CVD 9.1 以上、
// ダーク normal 15.4 以上・CVD 8.4 以上。薄い色は下地との対比が 3:1 に届かないので、
// 色だけで意味を運ばない（凡例・帯・表に段階名を必ず添える。この性質を壊さないこと）。
// 色の順序では進み具合を読めない。順序は番号と並び順で読む（オーナー了承済み）。
const STAGE_STYLE: Record<EssentialsStage, { stroke: string; bg: string }> = {
  '0 未収集': { stroke: 'stroke-[#cbd5e1] dark:stroke-[#4b5563]', bg: 'bg-[#cbd5e1] dark:bg-[#4b5563]' },
  '1 収集中': { stroke: 'stroke-[#7d7d7a] dark:stroke-[#94a3b8]', bg: 'bg-[#7d7d7a] dark:bg-[#94a3b8]' },
  '2 収集済': { stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]', bg: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  '3 骨子済': { stroke: 'stroke-[#eb6834] dark:stroke-[#d95926]', bg: 'bg-[#eb6834] dark:bg-[#d95926]' },
  '4 本文済': { stroke: 'stroke-[#1baf7a] dark:stroke-[#199e70]', bg: 'bg-[#1baf7a] dark:bg-[#199e70]' },
  '5 層3済': { stroke: 'stroke-[#eda100] dark:stroke-[#c98500]', bg: 'bg-[#eda100] dark:bg-[#c98500]' },
  '6 サブスク移行済': { stroke: 'stroke-[#e87ba4] dark:stroke-[#d55181]', bg: 'bg-[#e87ba4] dark:bg-[#d55181]' },
  '7 スプレッド公開': { stroke: 'stroke-[#008300] dark:stroke-[#008300]', bg: 'bg-[#008300] dark:bg-[#008300]' },
}
```

- [ ] **Step 2: 出典の一覧を書く**

`EssentialsCard.tsx` の `FetchQueue` の定義の前に `SourceTable` を足す:

```tsx
// 台帳の中身そのもの。「どんな文献を集めたのか」に答える場所。
// 絞り込み・並び替え・誌の内訳は essentials-admin.ts の純関数に通す（画面は描くだけ）。
function SourceTable({ sources, topics }: { sources: EssentialsSource[]; topics: EssentialsTopic[] }) {
  const [state, setState] = useState('')
  const [role, setRole] = useState('')
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SourceSort>('year-desc')

  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])
  const stateOptions = useMemo(() => [...new Set(sources.map((s) => s.state).filter(Boolean))].sort(), [sources])
  const roleOptions = useMemo(
    () => [...new Set(sources.map((s) => s.role).filter(Boolean))].sort((a, b) => roleRank(a) - roleRank(b)),
    [sources],
  )
  const ownerOptions = useMemo(() => [...new Set(sources.map((s) => s.owner).filter(Boolean))].sort(), [sources])
  const rows = useMemo(
    () => sortSources(filterSources(sources, { state, role, owner, q }), sort),
    [sources, state, role, owner, q, sort],
  )
  const journals = useMemo(() => journalCounts(rows, 8), [rows])

  // 紐づく主題の見出し。1件なら主題名、2件以上は「主題名 ほかN件」。
  const topicLabel = (s: EssentialsSource) => {
    const names = s.topicIds.map((id) => topicById.get(id)?.name).filter((n): n is string => !!n)
    if (names.length === 0) return '—'
    return names.length === 1 ? names[0] : `${names[0]} ほか${names.length - 1}件`
  }

  const SORTS: { key: SourceSort; label: string }[] = [
    { key: 'year-desc', label: '年（新しい順）' },
    { key: 'year-asc', label: '年（古い順）' },
    { key: 'role', label: '役割' },
    { key: 'journal', label: '誌' },
  ]

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">出典の一覧</h3>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {rows.length} / {sources.length} 件
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select value={state} onChange={(e) => setState(e.target.value)} className={SELECT} aria-label="状態">
          <option value="">状態: すべて</option>
          {stateOptions.map((x) => (<option key={x} value={x}>{x}</option>))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={SELECT} aria-label="役割">
          <option value="">役割: すべて</option>
          {roleOptions.map((x) => (<option key={x} value={x}>{x}</option>))}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={SELECT} aria-label="誰が取るか">
          <option value="">誰が取るか: すべて</option>
          {ownerOptions.map((x) => (<option key={x} value={x}>{x}</option>))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SourceSort)} className={SELECT} aria-label="並び替え">
          {SORTS.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="文献名・誌で絞る"
          className={`${SELECT} w-44`}
          aria-label="文献名・誌で絞る"
        />
      </div>

      {/* 誌の内訳。同じ雑誌が略記と正式名で割れていても、件数を並べれば気づける（名寄せはしない）。 */}
      {journals.top.length > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
          誌: {journals.top.map((j) => `${j.journal} ${j.count}`).join(' ／ ')}
          {journals.otherCount > 0 && ` ／ その他 ${journals.otherCount}`}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-1.5 pr-2">文献</th>
              <th className="py-1.5 pr-2 whitespace-nowrap">役割</th>
              <th className="py-1.5 pr-2 whitespace-nowrap">誌</th>
              <th className="py-1.5 pr-2 text-right whitespace-nowrap">年</th>
              <th className="py-1.5 pr-2 whitespace-nowrap">状態</th>
              <th className="py-1.5 whitespace-nowrap">主題</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700/60 align-top">
                <td className="py-1.5 pr-2 text-gray-800 dark:text-gray-100">
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {s.name || '（名前なし）'}
                  </a>
                </td>
                <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{s.role || '—'}</td>
                <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{s.journal || '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{s.year ?? '—'}</td>
                <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{s.state || '—'}</td>
                <td className="py-1.5 text-gray-600 dark:text-gray-300">{topicLabel(s)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-gray-400 dark:text-gray-500">
                  条件に合う出典がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: 一覧を画面に差し込む**

`EssentialsBody` の `return` の中、`<TopicTable ... />` と `<FetchQueue queue={queue} />` の間に足す:

```tsx
      <SourceTable sources={sources} topics={topics} />
```

import に Task 1 の3関数と型を足す（`filterSources`, `journalCounts`, `sortSources`, `type SourceSort`）。

- [ ] **Step 4: 型・テスト・ビルドを確かめる**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: 型エラーなし・全件PASS・ビルド成功

- [ ] **Step 5: 実データで確かめる**

`.preview/probe-sources.mts`（既にある）で台帳の件数・状態・役割・誌の内訳を出し、画面に出るはずの数と突き合わせる。
特に、絞り込みなしのときの件数（63）と誌の上位（同じ雑誌が2通りに割れている件）が一致すること。

- [ ] **Step 6: コミット**

```bash
git add src/app/admin/EssentialsCard.tsx
git commit -m "$(cat <<'EOF'
feat(admin): Essentials に出典の一覧を出し、段階を8色にする

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
