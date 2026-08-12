# 赤マーカー穴埋め＋間隔反復＋文言正直化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notionの赤背景マーカーを穴埋めクイズに変換し、SRSを本物の間隔反復（時間スケジューリング）に改め、クイズ関連の文言を実態に合わせる。

**Architecture:** 抽出は純関数 `extractCloze`（試作済み）。サブスクsyncは既に全ブロック取得済みなので1行追加、個人/部署syncは後付けの `attachClozeData`（前回レコード引き継ぎ＋fetch上限40）で載せる。カードはAlgoliaレコードだけで描画。SRSは `streak`/`due` を足したLeitner固定段（1/3/7/14/30日）。

**Tech Stack:** Next.js (App Router) / TypeScript / vitest / Algolia / Notion API / Tailwind（darkは`.dark`クラス基準）

**Spec:** `docs/superpowers/specs/2026-08-12-quiz-cloze-design.md`

## Global Constraints

- 作業場所: worktree `/Users/tatsukinonaka/medical-search-public/.worktrees/quiz-cloze-demo`（branch `trial/quiz-cloze-demo`。Task 1冒頭で `feat/quiz-cloze` にrename）。mainに直接触らない。
- 穴埋め印は `annotations.color === 'red_background'` のみ。機械推測マスク・LLM生成は書かない。
- 穴埋め表示はクイズタブ＋今日の1問限定。ResultCard系（検索・新着・ジャンル・文献）に`cloze`を渡す変更をしない。
- カードの左帯（border-left色）は既存の種別カラーの意味。穴埋め識別に流用しない。
- 文言は「行為に寄り添う静かな日本語」。感嘆符・宣伝調を使わない。
- テストは `npx vitest run <file>`。日付を跨ぐテストは `vi.setSystemTime` で固定する（JST深夜だけ落ちる既存テストの再発防止）。
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

前提（試作で実装済み・worktreeにコミット済み 25445d3）:
- `src/lib/cloze.ts` … `extractCloze(blocks): ClozeData | null`, `ClozeData = { blocks: {heading, segments:{text,hidden}[]}[], blankCount, truncated }`, `CLOZE_MAX_BLOCKS=3`
- `src/components/QuizCard.tsx` … `ClozeBody`（伏せ字/開示描画）・穴埋めNチップ・要約置換
- `src/components/ResultCard.tsx` … `Hit.cloze?: ClozeData`
- `src/app/dev/cloze/page.tsx` … devハーネス（development限定）

---

### Task 1: extractCloze のユニットテスト

**Files:**
- Test: `src/lib/__tests__/cloze.test.ts`（新規）
- 対象: `src/lib/cloze.ts`（試作済み・変更なしの想定）

**Interfaces:**
- Consumes: `extractCloze(blocks: unknown[]): ClozeData | null`（試作済み）
- Produces: なし（後続タスクの信頼の土台）

- [ ] **Step 0: ブランチをrename**

```bash
cd /Users/tatsukinonaka/medical-search-public/.worktrees/quiz-cloze-demo
git branch -m trial/quiz-cloze-demo feat/quiz-cloze
```

- [ ] **Step 1: テストを書く**

```ts
// src/lib/__tests__/cloze.test.ts
import { describe, it, expect } from 'vitest'
import { extractCloze, CLOZE_MAX_BLOCKS } from '@/lib/cloze'

const run = (text: string, mark = false) => ({
  plain_text: text,
  annotations: { color: mark ? 'red_background' : 'default' },
})
const bullet = (...rich: ReturnType<typeof run>[]) => ({
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: rich },
})
const h2 = (text: string) => ({ type: 'heading_2', heading_2: { rich_text: [run(text)] } })

describe('extractCloze', () => {
  it('マークなしなら null（従来フラッシュカードのまま）', () => {
    expect(extractCloze([h2('見出し'), bullet(run('マークなし'))])).toBeNull()
  })

  it('マークを含むブロックだけを直近見出しつきで抽出する', () => {
    const data = extractCloze([
      h2('A'),
      bullet(run('前置き '), run('30mg', true), run(' 後置き')),
      bullet(run('マークなし行')),
      h2('B'),
      bullet(run('別見出し '), run('隠す', true)),
    ])!
    expect(data.blocks).toHaveLength(2)
    expect(data.blocks[0].heading).toBe('A')
    expect(data.blocks[1].heading).toBe('B')
    expect(data.blankCount).toBe(2)
    expect(data.truncated).toBe(false)
  })

  it('隣接する同色runは1セグメントに結合される', () => {
    const data = extractCloze([bullet(run('a', true), run('b', true), run(' 平文'))])!
    expect(data.blocks[0].segments).toEqual([
      { text: 'ab', hidden: true },
      { text: ' 平文', hidden: false },
    ])
  })

  it('上限を超えるマークブロックは打ち切り、truncated=true', () => {
    const blocks = [1, 2, 3, 4, 5].map((n) => bullet(run(`項目${n} `), run(String(n), true)))
    const data = extractCloze(blocks)!
    expect(data.blocks).toHaveLength(CLOZE_MAX_BLOCKS)
    expect(data.truncated).toBe(true)
    expect(data.blankCount).toBe(3)
  })

  it('red（赤文字）はマーク扱いしない', () => {
    const redText = {
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: '警告', annotations: { color: 'red' } }] },
    }
    expect(extractCloze([redText])).toBeNull()
  })

  it('非テキストブロック・壊れた入力は無視する', () => {
    expect(extractCloze([null, {}, { type: 'image', image: {} }])).toBeNull()
  })
})
```

- [ ] **Step 2: 実行して通ることを確認**

Run: `npx vitest run src/lib/__tests__/cloze.test.ts`
Expected: 6 passed（試作実装が正しければ全緑。落ちたら cloze.ts を直す＝仕様はテストが正）

- [ ] **Step 3: コミット**

```bash
git add src/lib/__tests__/cloze.test.ts
git commit -m "test: extractClozeのユニットテスト（見出し追跡・結合・上限・赤文字除外）"
```

---

### Task 2: quiz-srs を本物の間隔反復に（streak/due＋Leitner段）

**Files:**
- Modify: `src/lib/quiz-srs.ts`
- Test: `src/lib/__tests__/quiz-srs.test.ts`（新規。既存テストがある場合はそこへ追記）

**Interfaces:**
- Produces:
  - `QuizStat` に `streak?: number` / `due?: string` 追加
  - `recordQuizResult(objectID, ok): QuizStat`（戻り値を返すよう変更。既存呼び出しは戻り値未使用なので互換）
  - `intervalLabelFor(streak: number): string` … '明日'|'3日後'|'1週間後'|'2週間後'|'1か月後'
  - `weightedQuizOrder(hits, nowMs?)` … 期限到来→未学習→期限前 の順

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/quiz-srs.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { recordQuizResult, weightedQuizOrder, intervalLabelFor, getQuizStat } from '@/lib/quiz-srs'

const NOW = new Date('2026-08-12T03:00:00Z')

describe('quiz-srs 間隔反復', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('覚えた連続でdueが 1→3→7→14→30日 と伸びる', () => {
    const days = (iso: string) => Math.round((Date.parse(iso) - NOW.getTime()) / 86_400_000)
    expect(days(recordQuizResult('a', true).due!)).toBe(1)
    expect(days(recordQuizResult('a', true).due!)).toBe(3)
    expect(days(recordQuizResult('a', true).due!)).toBe(7)
    expect(days(recordQuizResult('a', true).due!)).toBe(14)
    expect(days(recordQuizResult('a', true).due!)).toBe(30)
    expect(days(recordQuizResult('a', true).due!)).toBe(30) // 6回目以降も30日
  })

  it('まだ でstreakが0に戻り、dueは今', () => {
    recordQuizResult('a', true)
    const s = recordQuizResult('a', false)
    expect(s.streak).toBe(0)
    expect(Date.parse(s.due!)).toBe(NOW.getTime())
  })

  it('出題順: 期限到来 → 未学習 → 期限前', () => {
    recordQuizResult('due-now', false) // due=今
    recordQuizResult('later', true) // due=明日
    const order = weightedQuizOrder(
      [{ objectID: 'later' }, { objectID: 'fresh' }, { objectID: 'due-now' }],
      NOW.getTime(),
    ).map((h) => h.objectID)
    expect(order).toEqual(['due-now', 'fresh', 'later'])
  })

  it('期限が来た「覚えた」カードは先頭グループに戻る', () => {
    recordQuizResult('a', true) // due=明日
    const dayAfter = NOW.getTime() + 2 * 86_400_000
    const order = weightedQuizOrder([{ objectID: 'a' }, { objectID: 'fresh' }], dayAfter).map(
      (h) => h.objectID,
    )
    expect(order).toEqual(['a', 'fresh'])
  })

  it('旧データ（due欠損）は落ちない: ng→期限到来 / ok→期限前', () => {
    localStorage.setItem(
      'medinode_quiz_stats',
      JSON.stringify({
        oldNg: { ok: 0, ng: 1, last: '2026-08-01T00:00:00Z', lastResult: 'ng' },
        oldOk: { ok: 1, ng: 0, last: '2026-08-01T00:00:00Z', lastResult: 'ok' },
      }),
    )
    const order = weightedQuizOrder(
      [{ objectID: 'oldOk' }, { objectID: 'oldNg' }],
      NOW.getTime(),
    ).map((h) => h.objectID)
    expect(order).toEqual(['oldNg', 'oldOk'])
    expect(getQuizStat('oldNg')?.streak).toBeUndefined() // 読み出しで壊さない
  })

  it('intervalLabelFor', () => {
    expect(intervalLabelFor(1)).toBe('明日')
    expect(intervalLabelFor(2)).toBe('3日後')
    expect(intervalLabelFor(3)).toBe('1週間後')
    expect(intervalLabelFor(4)).toBe('2週間後')
    expect(intervalLabelFor(5)).toBe('1か月後')
    expect(intervalLabelFor(9)).toBe('1か月後')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/quiz-srs.test.ts`
Expected: FAIL（`intervalLabelFor` が未定義、due未実装）

- [ ] **Step 3: 実装**

`src/lib/quiz-srs.ts` の該当箇所を差し替え:

```ts
export type QuizStat = {
  ok: number // 「覚えた」回数
  ng: number // 「まだ」回数
  last: string // 最終申告日時（ISO）
  lastResult: 'ok' | 'ng'
  streak?: number // 連続「覚えた」回数（間隔の段を決める）
  due?: string // 次回出題日時（ISO）。旧データは欠損＝lastResultで代用
}

// Leitner固定段。streak n回目の「覚えた」で SRS_INTERVAL_DAYS[min(n,5)-1] 日後に。
export const SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

const INTERVAL_LABELS = ['明日', '3日後', '1週間後', '2週間後', '1か月後'] as const

// 申告後メッセージ用。streak=1 → '明日'
export function intervalLabelFor(streak: number): string {
  return INTERVAL_LABELS[Math.min(Math.max(streak, 1), INTERVAL_LABELS.length) - 1]
}

// 「覚えた」(ok=true)／「まだ」(ok=false) を記録し、更新後のstatを返す。
export function recordQuizResult(objectID: string, ok: boolean): QuizStat {
  const stats = loadStats()
  const cur = stats[objectID] || { ok: 0, ng: 0, last: '', lastResult: 'ng' as const }
  const now = new Date()
  if (ok) {
    cur.ok++
    cur.streak = (cur.streak || 0) + 1
    const days = SRS_INTERVAL_DAYS[Math.min(cur.streak, SRS_INTERVAL_DAYS.length) - 1]
    cur.due = new Date(now.getTime() + days * 86_400_000).toISOString()
  } else {
    cur.ng++
    cur.streak = 0
    cur.due = now.toISOString()
  }
  cur.last = now.toISOString()
  cur.lastResult = ok ? 'ok' : 'ng'
  stats[objectID] = cur
  saveStats(stats)
  return cur
}
```

`weightedQuizOrder` を差し替え（コメントも更新）:

```ts
// 間隔反復の出題順を返す（元配列は変更しない）。
//   ① 期限到来（due超過。「まだ」はdue=今なので常にここ）→ ② 未学習 → ③ 期限前の「覚えた」
// 期限前も隠さず末尾に置く（プールが小さい個人DBでタブが空になるのを防ぐ）。
// 旧データ（due欠損）は lastResult==='ng' を期限到来、'ok' を期限前として扱う。
export function weightedQuizOrder<T extends { objectID: string }>(
  hits: T[],
  nowMs: number = Date.now(),
): T[] {
  const stats = loadStats()
  const due: T[] = []
  const fresh: T[] = []
  const later: T[] = []
  for (const h of hits) {
    const s = stats[h.objectID]
    if (!s) {
      fresh.push(h)
      continue
    }
    const dueAt = s.due ? Date.parse(s.due) : s.lastResult === 'ng' ? 0 : Infinity
    if (dueAt <= nowMs) due.push(h)
    else later.push(h)
  }
  return [...shuffleInPlace(due), ...shuffleInPlace(fresh), ...shuffleInPlace(later)]
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/quiz-srs.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: 既存の呼び出し元が壊れていないか型チェック**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: エラーなし（`recordQuizResult` の戻り値追加・`weightedQuizOrder` の第2引数追加はどちらも後方互換）

- [ ] **Step 6: コミット**

```bash
git add src/lib/quiz-srs.ts src/lib/__tests__/quiz-srs.test.ts
git commit -m "feat: quiz-srsを本物の間隔反復に（streak/due・1/3/7/14/30日のLeitner段）"
```

---

### Task 3: 申告後メッセージの文言修正（QuizCard）

**Files:**
- Modify: `src/components/QuizCard.tsx`

**Interfaces:**
- Consumes: `recordQuizResult` の戻り値 `QuizStat`、`intervalLabelFor`（Task 2）

- [ ] **Step 1: answer() で戻り値を保持する**

`QuizCard` 内の state と `answer` を差し替え:

```ts
const [answered, setAnswered] = useState<'ok' | 'ng' | null>(null)
const [answeredStreak, setAnsweredStreak] = useState(0)

const answer = (ok: boolean) => {
  if (isTowerEnabled()) {
    // （既存の知の塔ブロックはそのまま・順序も変えない）
  }
  const stat = recordQuizResult(hit.objectID, ok)
  setAnsweredStreak(stat.streak || 0)
  setAnswered(ok ? 'ok' : 'ng')
}
```

（import に `intervalLabelFor` を追加: `import { recordQuizResult, getQuizStat, intervalLabelFor } from '@/lib/quiz-srs'`）

- [ ] **Step 2: メッセージ文言を差し替え**

現行（`覚えた！次回は後ろの方に出ます` / `記録しました。次回は優先して出ます`）を:

```tsx
{answered === 'ok' ? (
  <>
    <Check className="w-4 h-4" strokeWidth={2.5} />
    覚えた、と記録しました。次は{intervalLabelFor(answeredStreak)}ごろに出ます
  </>
) : (
  <>
    <RotateCcw className="w-4 h-4" strokeWidth={2.5} />
    まだ、と記録しました。忘れないうちに、またすぐ出します
  </>
)}
```

- [ ] **Step 3: devページで目視確認**

Run: dev server（.claude/launch.json の `quiz-cloze-demo`）で `http://localhost:3000/dev/cloze` を開き、覚えた/まだを押す
Expected: 「覚えた、と記録しました。次は明日ごろに出ます」（1回目）。連打で「3日後」に伸びることも確認

- [ ] **Step 4: コミット**

```bash
git add src/components/QuizCard.tsx
git commit -m "fix: 申告後メッセージを自然な日本語＋実際の間隔表示に"
```

---

### Task 4: サブスクsyncにcloze抽出を追加

**Files:**
- Modify: `src/app/api/subscription/sync/_core.ts`（`syncMedicalDb` のrecord組み立て、166行付近）
- Test: 既存 `src/lib/__tests__/admin-subscription-sync-route.test.ts` があれば1ケース追記。テスト構造が複雑で差し込みにくい場合は、抽出自体は Task 1 で担保済みなので「recordにclozeフィールドが載る」ことだけ確認する軽いケースでよい

**Interfaces:**
- Consumes: `extractCloze`（Task 1）
- Produces: サブスクAlgoliaレコードの `cloze: ClozeData | null`

- [ ] **Step 1: import追加と1行実装**

`_core.ts` 冒頭に `import { extractCloze } from '@/lib/cloze'`。
`syncMedicalDb` のrecordに追加（`contentChars` の並びに）:

```ts
        // 赤背景マーカー穴埋め（クイズタブ・今日の1問だけが使う。検索面では使わない）
        cloze: blocks ? extractCloze(blocks) : null,
```

※ サブスクsyncは統計・節分割のため既に全ブロックを取得済み（`fetchPageBlocks`）。追加のNotion APIコールはゼロ。
※ `searchableAttributes` には追加しない（本文重複の検索ノイズ防止）。

- [ ] **Step 2: 既存テストが壊れていないか確認**

Run: `npx vitest run src/lib/__tests__/admin-subscription-sync-route.test.ts`
Expected: PASS（record形状のスナップショット等があれば期待値に `cloze` を足す）

- [ ] **Step 3: コミット**

```bash
git add src/app/api/subscription/sync/_core.ts src/lib/__tests__/admin-subscription-sync-route.test.ts
git commit -m "feat: サブスクsyncで赤マーカー穴埋めを抽出しレコードに載せる"
```

---

### Task 5: 個人・部署syncにcloze抽出を追加（引き継ぎ＋上限つき）

**Files:**
- Create: `src/lib/cloze-sync.ts`
- Modify: `src/app/api/sync/route.ts`
- Test: `src/lib/__tests__/cloze-sync.test.ts`（新規）

**Interfaces:**
- Consumes: `extractCloze`（Task 1）
- Produces: `attachClozeData(records, clients, index): Promise<{ fetches: number; limitHit: boolean }>`、`CLOZE_FETCH_MAX = 40`、`isClozeCandidate(r): boolean`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/cloze-sync.test.ts
import { describe, it, expect } from 'vitest'
import { attachClozeData, isClozeCandidate, CLOZE_FETCH_MAX } from '@/lib/cloze-sync'

const marked = {
  type: 'paragraph',
  paragraph: {
    rich_text: [
      { plain_text: '答えは ', annotations: { color: 'default' } },
      { plain_text: '42', annotations: { color: 'red_background' } },
    ],
  },
}

function fakeNotion(blocks: unknown[] = [marked]) {
  const calls: string[] = []
  return {
    calls,
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          calls.push(block_id)
          return { results: blocks, has_more: false, next_cursor: null }
        },
      },
    },
  }
}

const emptyIndex = {
  getObjects: async () => ({ results: [] }),
}

function rec(objectID: string, extra: Record<string, unknown> = {}) {
  return {
    objectID,
    source: 'medical',
    owner: 'personal',
    knowledgeLevel: '💡 ナレッジ',
    lastEdited: '2026-08-12T00:00:00Z',
    ...extra,
  }
}

describe('isClozeCandidate', () => {
  it('ナレッジだけが対象（CQ・空・文献は対象外）', () => {
    expect(isClozeCandidate({ knowledgeLevel: '💡 ナレッジ' })).toBe(true)
    expect(isClozeCandidate({ knowledgeLevel: '❓ CQ' })).toBe(false)
    expect(isClozeCandidate({})).toBe(false)
  })
})

describe('attachClozeData', () => {
  it('新規候補は本文を取得してclozeを載せる', async () => {
    const notion = fakeNotion()
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.fetches).toBe(1)
    expect(notion.calls).toEqual(['p1']) // owner接頭辞を剥がしてページIDで呼ぶ
    expect((records[0] as { cloze?: { blankCount: number } }).cloze?.blankCount).toBe(1)
  })

  it('lastEditedが同じなら前回のclozeを引き継ぎ、fetchしない', async () => {
    const notion = fakeNotion()
    const prevCloze = { blocks: [], blankCount: 9, truncated: false }
    const index = {
      getObjects: async () => ({
        results: [{ objectID: 'personal_p1', lastEdited: '2026-08-12T00:00:00Z', cloze: prevCloze }],
      }),
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(0)
    expect((records[0] as { cloze?: unknown }).cloze).toEqual(prevCloze)
  })

  it('lastEditedが変わっていれば再取得する', async () => {
    const notion = fakeNotion()
    const index = {
      getObjects: async () => ({
        results: [{ objectID: 'personal_p1', lastEdited: '2026-08-01T00:00:00Z', cloze: null }],
      }),
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(1)
  })

  it('上限を超えたらfetchを止めて limitHit=true', async () => {
    const notion = fakeNotion()
    const records = Array.from({ length: CLOZE_FETCH_MAX + 5 }, (_, i) => rec(`personal_p${i}`))
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.fetches).toBe(CLOZE_FETCH_MAX)
    expect(res.limitHit).toBe(true)
  })

  it('ownerに対応するクライアントがなければ黙ってスキップ', async () => {
    const records = [rec('team_p1', { owner: 'team' })]
    const res = await attachClozeData(records, { personal: fakeNotion() }, emptyIndex)
    expect(res.fetches).toBe(0)
  })

  it('index未作成（getObjects例外）でも新規として動く', async () => {
    const notion = fakeNotion()
    const index = {
      getObjects: async () => {
        throw new Error('index does not exist')
      },
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(1)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/cloze-sync.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

```ts
// src/lib/cloze-sync.ts
// 個人・部署syncの後付けパス。クイズ候補（ナレッジ）だけ本文を読み、
// 赤マーカー穴埋めをレコードに載せる。レート対策の3点セット:
//   ① 候補限定 ② 前回同期から未編集なら前回のclozeを引き継ぐ（fetchなし）
//   ③ 1同期あたりの取得上限（bodyFallbackのBODY_FALLBACK_MAXと同思想）
import { extractCloze, type ClozeData } from './cloze'

export const CLOZE_FETCH_MAX = 40

type NotionLike = {
  blocks: {
    children: {
      list: (args: {
        block_id: string
        page_size: number
        start_cursor?: string
      }) => Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>
    }
  }
}

type PrevRow = { objectID?: string; lastEdited?: string; cloze?: ClozeData | null } | null
type IndexLike = {
  getObjects: (
    ids: string[],
    opts: { attributesToRetrieve: string[] },
  ) => Promise<{ results: PrevRow[] }>
}

// クイズタブの出題条件（page.tsxのquizCandidates）と同じ「ナレッジ」判定。
export function isClozeCandidate(r: { knowledgeLevel?: unknown }): boolean {
  const lvl = String(r.knowledgeLevel || '')
  return lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
}

// objectID は `${owner}_${pageId}`。owner接頭辞を剥がしてNotionページIDに戻す。
function pageIdOf(objectID: string): string {
  return objectID.replace(/^(personal|team)_/, '')
}

async function fetchAllBlocks(notion: NotionLike, pageId: string): Promise<unknown[] | null> {
  try {
    const blocks: unknown[] = []
    let cursor: string | undefined = undefined
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      })
      blocks.push(...res.results)
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    return blocks
  } catch {
    return null // 権限不足・アーカイブ済み等。cloze無しで続行（同期は止めない）
  }
}

export async function attachClozeData(
  records: Array<Record<string, unknown>>,
  clients: { personal?: NotionLike; team?: NotionLike },
  index: IndexLike,
): Promise<{ fetches: number; limitHit: boolean }> {
  const candidates = records.filter((r) => r.source === 'medical' && isClozeCandidate(r))
  if (candidates.length === 0) return { fetches: 0, limitHit: false }

  // 前回レコードを一括読取（初回同期・index未作成は空扱いで全件新規）
  const prev = new Map<string, { lastEdited?: string; cloze?: ClozeData | null }>()
  try {
    const res = await index.getObjects(
      candidates.map((r) => String(r.objectID)),
      { attributesToRetrieve: ['lastEdited', 'cloze'] },
    )
    for (const row of res.results) if (row?.objectID) prev.set(row.objectID, row)
  } catch {
    // index未作成など。全件を新規扱い
  }

  let fetches = 0
  let limitHit = false
  for (const r of candidates) {
    const client = clients[r.owner as 'personal' | 'team']
    if (!client) continue
    const p = prev.get(String(r.objectID))
    if (p && p.lastEdited && p.lastEdited === r.lastEdited) {
      if (p.cloze) r.cloze = p.cloze
      continue
    }
    if (fetches >= CLOZE_FETCH_MAX) {
      limitHit = true
      continue
    }
    fetches++
    const blocks = await fetchAllBlocks(client, pageIdOf(String(r.objectID)))
    if (!blocks) continue
    const cloze = extractCloze(blocks)
    if (cloze) r.cloze = cloze
  }
  return { fetches, limitHit }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/cloze-sync.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: /api/sync に配線**

`src/app/api/sync/route.ts`:
1. import追加: `import { attachClozeData } from '@/lib/cloze-sync'`
2. 部署syncのif文の外でクライアントを保持できるよう、`teamNotion` を `let teamNotionClient: Client | undefined` として先に宣言し、if内で代入する形に直す。
3. 部署Reference同期の後・`index.setSettings` の前に:

```ts
    // 赤マーカー穴埋めの抽出（ナレッジ候補のみ・未編集は前回結果を引き継ぎ・上限40）
    const clozeResult = await attachClozeData(
      records,
      { personal: notion, team: teamNotionClient },
      index,
    )
    if (clozeResult.limitHit) {
      warnings.push(
        '穴埋めの読み取りは1回の同期で40ページまでです。残りは次回以降の同期で読み取られます。',
      )
    }
```

- [ ] **Step 6: 全テスト＋型チェック**

Run: `npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -5`
Expected: 型エラーなし・既存テスト全緑

- [ ] **Step 7: コミット**

```bash
git add src/lib/cloze-sync.ts src/lib/__tests__/cloze-sync.test.ts src/app/api/sync/route.ts
git commit -m "feat: 個人・部署syncに赤マーカー穴埋め抽出（前回引き継ぎ＋上限40）"
```

---

### Task 6: 今日の1問にclozeを通す

**Files:**
- Modify: `src/lib/daily-question-server.ts`（`attributesToRetrieve` と戻り値型）
- Modify: `src/app/api/daily-question/route.ts`（payloadに`cloze`）
- Modify: `src/components/DailyQuestionCard.tsx`（cloze描画）
- Modify: `src/components/QuizCard.tsx`（`ClozeBody` をexport）

**Interfaces:**
- Consumes: `ClozeBody`（QuizCard内・exportに変更）、`ClozeData`
- Produces: `/api/daily-question` レスポンスに `cloze?: ClozeData`

- [ ] **Step 1: サーバー側でclozeを拾う**

`src/lib/daily-question-server.ts`:
- 戻り値型（`answer: string` の並び）に `cloze?: import('./cloze').ClozeData | null` を追加
- `attributesToRetrieve` に `'cloze'` を追加
- pick組み立て（`answer: q.aiSummary || q.summary || ''` の並び）に `cloze: q.cloze ?? null` を追加

`src/app/api/daily-question/route.ts` のレスポンスに追加:

```ts
    answer: pick.answer,
    ...(pick.cloze ? { cloze: pick.cloze } : {}),
```

- [ ] **Step 2: カード側で描画**

`src/components/QuizCard.tsx` の `function ClozeBody` を `export function ClozeBody` に変更。

`src/components/DailyQuestionCard.tsx`:
- `DailyQuestionPayload` に `cloze?: import('@/lib/cloze').ClozeData` を追加
- import追加: `import { ClozeBody } from './QuizCard'`
- 設問表示部（タイトルの下）に、clozeがあれば `<ClozeBody cloze={data.cloze} revealed={state.revealed} />` を挿入
- 答え表示部は `data.cloze` があるときは `answer`（要約）を出さない（クイズタブと同じ置換ルール）

- [ ] **Step 3: 既存テスト確認**

Run: `npx vitest run src/lib/__tests__/daily-question.test.ts`
Expected: PASS（`attributesToRetrieve` を検証するケースがあれば期待値に'cloze'を足す）

- [ ] **Step 4: コミット**

```bash
git add src/lib/daily-question-server.ts src/app/api/daily-question/route.ts src/components/DailyQuestionCard.tsx src/components/QuizCard.tsx
git commit -m "feat: 今日の1問でも赤マーカー穴埋めを出題する"
```

---

### Task 7: 文言の正直化（オンボーディング・ツアー・ヘルプ）

**Files:**
- Modify: `src/components/OnboardingScreen.tsx:63,136`
- Modify: `src/components/FeatureTour.tsx:84`
- Modify: `src/lib/help-faq.ts`（クイズ・CQカテゴリに1エントリ追加）

- [ ] **Step 1: OnboardingScreen**

- 63行 `desc: 'フラッシュカードで隙間時間に反復学習'` → `desc: 'フラッシュカードと穴埋めで、隙間時間に反復学習'`
- 136行 `{ Icon: Lightbulb, label: '一問一答クイズ' }` → `{ Icon: Lightbulb, label: 'フラッシュカード・穴埋め' }`

- [ ] **Step 2: FeatureTour**

84行の `クイズ＝ナレッジからの出題。` を `クイズ＝ナレッジからの出題（Notionで赤マーカーを引いた場所は穴埋め問題になります）。` に差し替え。

- [ ] **Step 3: help-faq にエントリ追加**

`FAQ_ENTRIES` のクイズ・CQカテゴリ末尾に:

```ts
  {
    id: 'quiz-cloze-marker',
    category: 'クイズ・CQ',
    q: 'クイズを穴埋め問題にできる？',
    a: 'できます。Notionのページ本文で、覚えたい場所に赤の背景色（蛍光マーカーの赤）を引いてから同期すると、その場所が伏せ字になった穴埋め問題がクイズタブに出ます。マークはブロック単位で拾われ、多くマークしたページは先頭の3ブロックまで出題されます。コツは、%や単位の断片ではなく「臨床判断が変わる値や語」に引くこと。マークのないページは、これまで通りタイトル→要約のフラッシュカードのままです。',
    keywords: '穴埋め 赤マーカー 蛍光ペン ハイライト red クイズ 伏せ字 マーク 問題 作り方',
  },
```

- [ ] **Step 4: 全テスト**

Run: `npx vitest run 2>&1 | tail -3`
Expected: 全緑

- [ ] **Step 5: コミット**

```bash
git add src/components/OnboardingScreen.tsx src/components/FeatureTour.tsx src/lib/help-faq.ts
git commit -m "docs: クイズ文言を実態通りに（フラッシュカード・穴埋め）＋FAQに赤マーカーの使い方"
```

---

### Task 8: 総仕上げ（ビルド・目視・着手前チェックの実行）

**Files:**
- 変更なし（検証のみ）＋必要なら微修正

- [ ] **Step 1: ビルドと全テスト**

Run: `npx tsc --noEmit && npx next build 2>&1 | tail -5 && npx vitest run 2>&1 | tail -3`
Expected: すべて成功

- [ ] **Step 2: devページ目視**

dev serverで `http://localhost:3000/dev/cloze` を開き:
- 伏せ字→開示→「覚えた、と記録しました。次は明日ごろに出ます」
- マークなしカードが従来表示のまま
- ダークモードでも赤ハイライトが読めること（`resize_window` colorScheme: dark）

- [ ] **Step 3: 着手前チェック＝既存サブスクナレッジ約20枚のred_background使用状況**

オーナーのNotionトークン（.env.local の subscription 用）で全ページを走査し、
`red_background` の既存使用が0件であることを確認するスクリプトを scratchpad に書いて実行。
使用が見つかった場合は**その場で止めてオーナーに報告**（印の色の再選定が必要になるため）。
0件なら結果（走査ページ数・0件）を記録してそのまま進む。

- [ ] **Step 4: コミット・完了報告**

```bash
git log --oneline main..HEAD
```

superpowers:finishing-a-development-branch でマージ方法をオーナーに確認
（本番デプロイはpush運用＝mainへマージ後にpush。オーナーの実Notionでマーカーを引いて
実データ確認するのはデプロイ後）。

---

## 計画外（別セッション・別判断）

- LPの「自動でクイズ」系表現の洗い出し・差し替え（LPは別リポジトリ。デプロイ後にmedinode-snsスキルの文脈で）
- はじめてガイド（Notionページ）への赤マーカー説明の追記（Notion MCPで実施）
- 個人・部署のアプリ内リーダー（第2弾。/adminのクイズ利用数値を見てから）
