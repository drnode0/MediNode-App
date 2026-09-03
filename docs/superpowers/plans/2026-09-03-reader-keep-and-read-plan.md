# 部品1「読む画面の残すと読んだ」実装計画

> **実装する人へ:** このファイルは `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` で1タスクずつ進める前提で書いてあります。手順は `- [ ]` のチェックボックスです。

日付: 2026-09-03
状態: **オーナー確認待ち。着手前。**
先行資料: [双輪サイクルの骨組み](../specs/2026-09-03-cycle-skeleton-design.md)（部品1・継ぎ目1〜3・10）／[Recall 定着エンジン設計](../specs/2026-09-02-recall-engine-design.md)

**目的:** 読む画面から主張1つを「残す」、節1つを「読んだ」と記録できるようにし、その結果が Recall の球に即座に映るようにする。

**方針:** 新しいテーブル・新しいAPI・新しいIDは作らない。既存の `/api/recall/keep` と `/api/recall/read` を呼ぶだけにする。claimId はクライアントで作らず、`/api/recall/claims` が返す確定済みの値を本文テキストで引き当てる。読む画面と Recall 画面が同じ在庫（Provider）を見るので、即時反映は状態を共有した結果として自動的に成立する。

**技術:** Next.js App Router / React 18 / Supabase / Vitest（jsdom なし・testing-library なし）

## 全体の制約

- **テストは DOM を持たない。** `vitest.config.ts` に `environment` の指定が無く、`@testing-library/*` も入っていない。したがって**判断のロジックはすべて純関数に出し、その純関数をテストする**。コンポーネントの描画はテストせず、実機確認で見る
- **テストは実データを通す。** 自作の文字列ではなく `.preview/grains.json`（実測700粒）と本番の `recall_claims` の形を使う
- **主張の鍵は `claimIdOf(ページID, 本文)` のみ。** 別種のIDを作らない（継ぎ目1）
- **一括操作を作らない。**「全部残す」「この節を全部残す」は置かない（継ぎ目10）
- **`hasFeature('recall')` が偽の利用者には、Node も節末ボタンも描かない。** サーバー側は既に404で塞いでいる
- **端末ローカルの読了水位（`ReaderMarksProvider`）とは統合しない。**別物として並存させる（継ぎ目3）
- **文言の禁止語彙を守る。**「振る」「拾う」「血肉」等は UI 文言に使わない
- ダッシュ「——」を使わない

---

## 0. 着手前の確認：マイグレーション0029（実施済み・結果を記録）

**依頼された確認を実環境で行いました。台帳の記録は誤りでした。**

確認方法: `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を読み、PostgREST に対して `Prefer: count=exact` の読み取り専用リクエストを4テーブルへ送りました。書き込みは行っていません。

| 対象 | 結果 |
|---|---|
| Supabase プロジェクト | `jojhnouabtyxrmwwxksx.supabase.co`（`user_settings` に84行あり、本番と確認） |
| `recall_claims` | **存在・687行**（うち active 687件・cloze 承認 0件） |
| `recall_section_reads` | **存在・0行** |
| `recall_progress` | **存在・0行** |
| `recall_review_log` | **存在・0行** |
| `reader_spreads`（比較用） | 存在・4行 |

**結論: 0029 は本番に適用済み。** `supabase/migrations/README.md:51` の「⬜ 未適用」は古い記録です。適用手順・ロールバック手順は不要になりました。

**ただし着手条件は満たしていません。** 骨組みの部品1の着手条件は「`recall_claims` に主張が入り、**残す→確かめる→覚えた の一周が本番で通っている**」です。`recall_progress` が0行なので、一周はまだ通っていません。

- 実装前にオーナーが行う操作: **Recall タブを開き、主張を1つタップして閲覧カードから「残す」を押す。**翌日に「確かめる」で出題されるので、「覚えた」を1回押す。これで `recall_progress` と `recall_review_log` に各1行入り、着手条件が満たされます
- 副次的に分かること: `cloze_status` の承認が0件なので、いま出るカードは**全件が想起カード**（全文伏せ）です。伏せ字カードを見たい場合は `/admin` の「Recall カード」で承認が要ります

### 台帳の訂正（Task 0 に含める）

`supabase/migrations/README.md` の0029の行を「✅（2026-09-03 に実測。687件）」へ直します。

---

## 1. 変更対象ファイル

### 新規作成（6ファイル）

| ファイル | 責務 |
|---|---|
| `src/lib/recall/claim-text.ts` | 主張判定の純テキスト関数。`extract-claims.ts` から crypto に依存しない部分を移す。**規約の正はここ1か所**（継ぎ目12） |
| `src/lib/recall/reader-claims.ts` | 読む画面用の索引。本文行のテキストから確定済み claim を引き当てる。節キーと節末位置の導出 |
| `src/lib/recall/optimistic.ts` | 楽観反映と巻き戻しの純関数。成功・失敗・取り消しの3経路はすべてここが決める |
| `src/components/recall/RecallProvider.tsx` | claims・progress・reads の在庫と保存操作を1か所に集める。読む画面と Recall 画面が同じ在庫を見る |
| `src/components/reader/RecallNode.tsx` | 本文行末の丸い Node。44px の当たり判定を内側に持つ |
| `src/components/reader/SectionReadButton.tsx` | 節末の「この節を読んだ」ボタン |

### 変更（6ファイル）

| ファイル | 変更内容 |
|---|---|
| `src/lib/recall/extract-claims.ts` | 移した関数を `claim-text.ts` から再輸出するだけにする（振る舞いは変えない） |
| `src/components/recall/useRecallData.ts` | 取得と保存を Provider に委ね、導出（配置・粒・目印・候補・期限）だけを残す |
| `src/components/reader/ReaderBody.tsx` | `RenderedBlocks` の箇条書きに Node を、節の切れ目に節末ボタンを置く |
| `src/components/reader/spread/ReaderSpread.tsx` | 節ごとに `ReaderRecallCtx` を張り、節末（問いの箱の後）にボタンを置く |
| `src/app/page.tsx` | 3か所の `<ReaderMarksProvider>` の外側に `<RecallProvider>` を足す |
| `supabase/migrations/README.md` | 0029の適用状況を訂正 |

### 新規テスト（3ファイル）＋既存テストの更新（1ファイル）

| ファイル | 内容 |
|---|---|
| `src/lib/__tests__/recall-reader-claims.test.ts`（新） | 実データ700粒で索引と引き当てを検査 |
| `src/lib/__tests__/recall-optimistic.test.ts`（新） | 楽観反映・失敗の巻き戻し・取り消しの純関数 |
| `src/lib/__tests__/recall-reader-sections.test.ts`（新） | 節キーの導出と節末位置 |
| `src/lib/__tests__/recall-data-hook.test.ts`（更新） | fetch の担当が Provider へ移るぶんを差し替え |

---

## 2. タスク（ファイルごとの変更内容と手順）

### Task 0: 台帳の訂正

**Files:** Modify: `supabase/migrations/README.md:51`

- [ ] **Step 1: 該当行を直す**

```markdown
| 0029 | recall | `recall_claims`, `recall_section_reads`, `recall_progress`, `recall_review_log` | ✅ ※6 |
```

同ファイルの脚注一覧に次を足す。

```markdown
※6 2026-09-03 に本番（jojhnouabtyxrmwwxksx）へ読み取り専用で実測。4表とも存在し、
   recall_claims は687行（active 687・cloze承認0）。以前の「未適用」は記録漏れ。
```

- [ ] **Step 2: コミット**

```bash
git add supabase/migrations/README.md
git commit -m "docs: マイグレーション0029の適用状況を実測で訂正"
```

---

### Task 1: 主張判定の純テキスト関数を切り出す

crypto に依存する `claimIdOf` と、Notion ブロックを歩く `extractClaims` を残したまま、テキストだけを見る関数をクライアントでも読める場所へ移す。**振る舞いは1文字も変えない。**

**Files:**
- Create: `src/lib/recall/claim-text.ts`
- Modify: `src/lib/recall/extract-claims.ts`
- Test: `src/lib/__tests__/recall-extract-claims.test.ts`（既存。import 先を変えずに通ることを確認する）

**Interfaces:**
- Produces: `normalizeBody(s: string): string` / `normalizePageId(pageId: string): string` / `splitClaim(text: string): ClaimSplit` / `type ClaimSplit = { body: string; source: string; confidence: RecallConfidence } | null` / `SECTION_HEAD_RE: RegExp`

- [ ] **Step 1: 新ファイルを作る（既存コードをそのまま移す）**

```ts
// src/lib/recall/claim-text.ts
// 主張の判定と正規化のうち、テキストだけを見る部分。crypto にも Notion にも依存しない。
// 読む画面（クライアント）と同期（サーバー）が同じ規約を見るための1か所（骨組みの継ぎ目12）。
import type { RecallConfidence } from './types'

const MARK = /[✅⚠❓]/u
const TAIL = /[。）)]\s*([^。]{2,40})$/u
const SRCWORD = /(?:19|20)\d{2}|ガイドライン|合意|提言|指針|学会|Guideline|BTS|ERS|ATS|ESICM|JAMA|NEJM|Lancet|Chest|ICM/u

// 番号付き H2 の判定。節キー sec{n} の n はここから取る。
export const SECTION_HEAD_RE = /^(\d+)\.\s*(.+)$/

export function normalizeBody(s: string): string {
  return s.normalize('NFC').replace(/️/g, '').replace(/\s+/g, ' ').trim()
}

export function normalizePageId(pageId: string): string {
  return pageId.trim().toLowerCase().replace(/-/g, '')
}

export type ClaimSplit = { body: string; source: string; confidence: RecallConfidence } | null

export function splitClaim(text: string): ClaimSplit {
  const s = text.trim()
  if (s.includes('❓')) return null
  const mi = s.search(MARK)
  if (mi >= 0) {
    const mark = s[mi]
    return { body: s.slice(0, mi).trim(), source: s.slice(mi).trim(), confidence: mark === '✅' ? 'ok' : 'caut' }
  }
  const m = s.match(TAIL)
  if (m && SRCWORD.test(m[1]) && !/。$/.test(m[1])) {
    return { body: s.slice(0, s.length - m[1].length).trim(), source: m[1].trim(), confidence: 'essentials' }
  }
  return null
}
```

- [ ] **Step 2: `extract-claims.ts` から重複定義を消し、再輸出にする**

`extract-claims.ts` の先頭の `MARK` / `TAIL` / `SRCWORD` / `SECTION_HEAD_RE` の定義と、`normalizeBody` / `normalizePageId` / `splitClaim` / `type Split` の実装を削り、次に差し替える。

```ts
import { normalizeBody, normalizePageId, splitClaim, SECTION_HEAD_RE } from './claim-text'
// 既存の呼び出し元（sync-claims.ts・API・テスト）が import 先を変えずに済むよう再輸出する。
export { normalizeBody, normalizePageId, splitClaim } from './claim-text'
```

`splitClaim` を使っている箇所（`extractClaims` の中の `const sp = splitClaim(text)`）はそのまま。ローカルの `type Split` は消し、`ClaimSplit` は使わない（`extractClaims` の中では型推論で足りる）。

- [ ] **Step 3: 既存テストが通ることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-extract-claims.test.ts src/lib/__tests__/recall-sync-claims.test.ts`
Expected: PASS（振る舞いを変えていないので、1件も落ちてはいけない）

- [ ] **Step 4: コミット**

```bash
git add src/lib/recall/claim-text.ts src/lib/recall/extract-claims.ts
git commit -m "refactor(recall): 主張判定のテキスト部分を claim-text.ts へ切り出す"
```

---

### Task 2: 本文行から確定済み claim を引き当てる

**クライアントでハッシュを作らない。**`/api/recall/claims` が返す確定済みの claim を、正規化した本文テキストで引く。取りこぼしても「Node が出ない」で済み、別の主張に付くことはない。

**Files:**
- Create: `src/lib/recall/reader-claims.ts`
- Test: `src/lib/__tests__/recall-reader-claims.test.ts`

**Interfaces:**
- Consumes: `normalizeBody` / `splitClaim` / `normalizePageId`（Task 1）、`RecallClaim`（`types.ts`）
- Produces: `type ClaimIndex = Map<string, RecallClaim>` / `buildClaimIndex(claims: RecallClaim[], pageId: string): ClaimIndex` / `claimForRowText(index: ClaimIndex, rowText: string): RecallClaim | null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-reader-claims.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildClaimIndex, claimForRowText } from '@/lib/recall/reader-claims'
import { claimIdOf } from '@/lib/recall/extract-claims'
import type { RecallClaim } from '@/lib/recall/types'

// 実データ（.preview/grains.json）。p=ページ名 g=ジャンル h=節見出し b=本文 s=出典 k=穴
type Grain = { p: string; g: string; h: string; b: string; s: string; k: [number, number][] }
const grains: Grain[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../.preview/grains.json'), 'utf8'),
)

const PAGE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90' // 実データにページIDが無いので固定値を当てる

function toClaim(g: Grain): RecallClaim {
  return {
    claimId: claimIdOf(PAGE, g.b), pageId: PAGE, pageTitle: g.p, pageKind: '💡',
    sectionKey: 'sec1', sectionHeading: g.h, body: g.b, source: g.s,
    confidence: 'ok', genres: [g.g], primaryGenre: g.g, genreSlot: 5,
    holes: g.k, clozeStatus: 'pending', active: true,
  }
}

describe('reader-claims', () => {
  it('本文＋出典が1行になった実データの行から、元の主張を引き当てる', () => {
    const sample = grains.slice(0, 200).map(toClaim)
    const index = buildClaimIndex(sample, PAGE)
    let hit = 0
    for (const g of grains.slice(0, 200)) {
      // 読む画面が持つのは「本文＋マーク＋出典」が1つに繋がった行のテキスト
      const rowText = `${g.b}${g.s}`
      const found = claimForRowText(index, rowText)
      if (found && found.body === g.b) hit++
    }
    // 取りこぼしは Node が出ないだけで害は無いが、実データで9割を切るなら判定がずれている
    expect(hit / 200).toBeGreaterThan(0.9)
  })

  it('主張でない行（❓を含む・出典が無い）には何も返さない', () => {
    const index = buildClaimIndex(grains.slice(0, 50).map(toClaim), PAGE)
    expect(claimForRowText(index, 'これは本文だが出典もマークも無い行。')).toBeNull()
    expect(claimForRowText(index, '未確認の記載である。❓ 出典なし')).toBeNull()
  })

  it('別ページの主張は索引に入れない', () => {
    const index = buildClaimIndex(grains.slice(0, 20).map(toClaim), 'ffffffffffffffffffffffffffffffff')
    expect(index.size).toBe(0)
  })

  it('絵文字の異体字（U+FE0F）の有無で引き当てが外れない', () => {
    const g = grains.find((x) => x.s.startsWith('✅'))!
    const index = buildClaimIndex([toClaim(g)], PAGE)
    const withVs = `${g.b}✅️ ${g.s.replace(/^✅\s*/, '')}`
    expect(claimForRowText(index, withVs)?.body).toBe(g.b)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-reader-claims.test.ts`
Expected: FAIL（`Cannot find module '@/lib/recall/reader-claims'`）

- [ ] **Step 3: 最小の実装を書く**

```ts
// src/lib/recall/reader-claims.ts
// 読む画面が「この行はどの主張か」を知るための索引。
// クライアントでハッシュを作らない（サーバーとハッシュの実装がずれる危険を作らない）。
// 引くのは /api/recall/claims が返した確定済みの claim だけで、
// 見つからなければ null を返す＝その行に Node を出さない。誤って別の主張に付くことはない。
import { normalizeBody, normalizePageId, splitClaim } from './claim-text'
import type { RecallClaim } from './types'

export type ClaimIndex = Map<string, RecallClaim>

// 正規化した本文 → 主張。ページで絞ってから作る（同じ文が別ページにあっても混ざらない）。
export function buildClaimIndex(claims: RecallClaim[], pageId: string): ClaimIndex {
  const want = normalizePageId(pageId)
  const map: ClaimIndex = new Map()
  for (const c of claims) {
    if (normalizePageId(c.pageId) !== want) continue
    if (!c.active) continue
    map.set(normalizeBody(c.body), c)
  }
  return map
}

// 本文行のテキスト（本文＋マーク＋出典が1つに繋がったもの）から主張を引く。
// 判定は同期側とまったく同じ splitClaim を通すので、規約が2か所に増えない。
export function claimForRowText(index: ClaimIndex, rowText: string): RecallClaim | null {
  const sp = splitClaim(rowText)
  if (!sp || !sp.body) return null
  return index.get(normalizeBody(sp.body)) ?? null
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-reader-claims.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/reader-claims.ts src/lib/__tests__/recall-reader-claims.test.ts
git commit -m "feat(recall): 本文行から確定済みの主張を引き当てる索引"
```

---

### Task 3: 節キーと節末の位置を求める

節キーは同期側と同じ規則（番号付き H2 → `sec{n}`、最初の見出しより前は `sec0`）。

**Files:**
- Modify: `src/lib/recall/reader-claims.ts`（追記）
- Test: `src/lib/__tests__/recall-reader-sections.test.ts`

**Interfaces:**
- Produces: `sectionKeysByBlock(blocks: ReaderBlock[]): string[]` / `sectionEnds(blocks: ReaderBlock[]): { sectionKey: string; afterIndex: number }[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-reader-sections.test.ts
import { describe, it, expect } from 'vitest'
import { sectionKeysByBlock, sectionEnds } from '@/lib/recall/reader-claims'
import type { ReaderBlock } from '@/lib/reader-doc'

const h2 = (t: string): ReaderBlock => ({ kind: 'heading', level: 2, inlines: [{ text: t }] })
const li = (t: string): ReaderBlock => ({ kind: 'list_item', ordered: false, inlines: [{ text: t }] })
const p = (t: string): ReaderBlock => ({ kind: 'paragraph', inlines: [{ text: t }] })

describe('節キーの導出', () => {
  it('番号付きH2の前は sec0、以後はその番号', () => {
    const blocks = [p('前置き'), h2('1. 定義'), li('あ'), h2('2. 数値'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec0', 'sec1', 'sec1', 'sec2', 'sec2'])
  })

  it('番号の無いH2では節を切り替えない（同期側の SECTION_HEAD_RE と同じ）', () => {
    const blocks = [h2('1. 定義'), li('あ'), h2('まとめ'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec1', 'sec1', 'sec1', 'sec1'])
  })

  it('題名の無い「3.」だけの見出しは節境界にしない', () => {
    const blocks = [h2('1. 定義'), li('あ'), h2('3.'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec1', 'sec1', 'sec1', 'sec1'])
  })
})

describe('節末の位置', () => {
  it('番号付き節ごとに、その節の最後のブロックの位置を返す', () => {
    const blocks = [p('前置き'), h2('1. 定義'), li('あ'), li('い'), h2('2. 数値'), li('う')]
    expect(sectionEnds(blocks)).toEqual([
      { sectionKey: 'sec1', afterIndex: 3 },
      { sectionKey: 'sec2', afterIndex: 5 },
    ])
  })

  it('sec0（見出しより前）には節末を作らない', () => {
    expect(sectionEnds([p('前置きだけ')])).toEqual([])
  })
})
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-reader-sections.test.ts`
Expected: FAIL（`sectionKeysByBlock is not a function`）

- [ ] **Step 3: `reader-claims.ts` に追記する**

```ts
import { SECTION_HEAD_RE } from './claim-text'
import type { ReaderBlock } from '@/lib/reader-doc'

// ブロックの並びと同じ長さの、各ブロックが属する節キーの配列。
// 節の切り替えは「番号付きH2」だけ。同期側（extract-claims）と同じ規則にしないと、
// 「読んだ」の記録と主張の突き合わせが静かに外れる（エラーが出ない種類の壊れ方）。
export function sectionKeysByBlock(blocks: ReaderBlock[]): string[] {
  let cur = 'sec0'
  return blocks.map((b) => {
    if (b.kind === 'heading' && b.level === 2) {
      const t = b.inlines.map((i) => i.text).join('').trim()
      const m = t.match(SECTION_HEAD_RE)
      if (m) cur = `sec${m[1]}`
    }
    return cur
  })
}

// 番号付き節ごとの「最後のブロックの位置」。節末ボタンをこの直後に置く。
// sec0（最初の見出しより前＝⚡結論・署名・大前提）には置かない。
export function sectionEnds(blocks: ReaderBlock[]): { sectionKey: string; afterIndex: number }[] {
  const keys = sectionKeysByBlock(blocks)
  const out: { sectionKey: string; afterIndex: number }[] = []
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === 'sec0') continue
    const last = out[out.length - 1]
    if (last && last.sectionKey === keys[i]) last.afterIndex = i
    else out.push({ sectionKey: keys[i], afterIndex: i })
  }
  return out
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-reader-sections.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/reader-claims.ts src/lib/__tests__/recall-reader-sections.test.ts
git commit -m "feat(recall): 節キーと節末の位置を求める純関数"
```

---

### Task 4: 楽観反映・巻き戻し・取り消しの純関数

画面の見え方を決める3経路を、コンポーネントの外に出す。

**Files:**
- Create: `src/lib/recall/optimistic.ts`
- Test: `src/lib/__tests__/recall-optimistic.test.ts`

**Interfaces:**
- Consumes: `newProgress`（`srs.ts`）、`RecallProgress` / `RecallSectionRead`（`types.ts`）
- Produces: `keepOptimistic(list, claimId, keep, now): RecallProgress[]` / `replaceProgress(list, row): RecallProgress[]` / `readOptimistic(list, pageId, sectionKey, now): RecallSectionRead[]` / `removeRead(list, pageId, sectionKey): RecallSectionRead[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-optimistic.test.ts
import { describe, it, expect } from 'vitest'
import { keepOptimistic, replaceProgress, readOptimistic, removeRead } from '@/lib/recall/optimistic'
import type { RecallProgress } from '@/lib/recall/types'

const NOW = new Date('2026-09-10T03:00:00.000Z')
const row = (claimId: string, over: Partial<RecallProgress> = {}): RecallProgress => ({
  claimId, keptAt: '2026-09-01T00:00:00.000Z', streak: 3, intervalDays: 7,
  dueAt: '2026-09-08T00:00:00.000Z', lastReviewedAt: '2026-09-01T00:00:00.000Z',
  lastResult: 'ok', okCount: 3, ngCount: 0, removedAt: null, ...over,
})

describe('残すの楽観反映', () => {
  it('記録が無い主張を残すと、間隔1日・期限翌日の行がその場で増える', () => {
    const next = keepOptimistic([], 'c1', true, NOW)
    expect(next).toHaveLength(1)
    expect(next[0].claimId).toBe('c1')
    expect(next[0].intervalDays).toBe(1)
    expect(next[0].removedAt).toBeNull()
  })

  it('外していた主張を残し直すと、段と間隔を引き継いだまま removedAt だけ外れる', () => {
    const prev = [row('c1', { removedAt: '2026-09-05T00:00:00.000Z' })]
    const next = keepOptimistic(prev, 'c1', true, NOW)
    expect(next[0].streak).toBe(3)
    expect(next[0].intervalDays).toBe(7)
    expect(next[0].removedAt).toBeNull()
  })

  it('外すと removedAt が立つが、行そのものは消えない（再開の履歴を消さない）', () => {
    const next = keepOptimistic([row('c1')], 'c1', false, NOW)
    expect(next).toHaveLength(1)
    expect(next[0].removedAt).toBe(NOW.toISOString())
  })

  it('元の配列を書き換えない（失敗したときに巻き戻せる必要がある）', () => {
    const prev = [row('c1')]
    keepOptimistic(prev, 'c1', false, NOW)
    expect(prev[0].removedAt).toBeNull()
  })
})

describe('サーバーの答えで置き換える', () => {
  it('同じ主張の行を、返ってきた行で入れ替える（重複させない）', () => {
    const server = row('c1', { streak: 4, intervalDays: 14 })
    const next = replaceProgress([row('c1'), row('c2')], server)
    expect(next).toHaveLength(2)
    expect(next.find((p) => p.claimId === 'c1')!.intervalDays).toBe(14)
  })
})

describe('読んだの楽観反映', () => {
  it('同じ節を二度押しても1行のまま', () => {
    const a = readOptimistic([], 'pg', 'sec1', NOW)
    const b = readOptimistic(a, 'pg', 'sec1', NOW)
    expect(b).toHaveLength(1)
  })

  it('ページIDはダッシュ無し・小文字に揃えて持つ（記録側と同じ形）', () => {
    const a = readOptimistic([], 'AB-CD', 'sec1', NOW)
    expect(a[0].pageId).toBe('abcd')
  })

  it('失敗したら、いま足した行だけを取り消せる', () => {
    const a = readOptimistic([{ pageId: 'x', sectionKey: 'sec1', readAt: '2026-01-01T00:00:00.000Z' }], 'pg', 'sec2', NOW)
    const b = removeRead(a, 'pg', 'sec2')
    expect(b).toHaveLength(1)
    expect(b[0].pageId).toBe('x')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-optimistic.test.ts`
Expected: FAIL（`Cannot find module '@/lib/recall/optimistic'`）

- [ ] **Step 3: 実装を書く**

```ts
// src/lib/recall/optimistic.ts
// 押した瞬間の画面と、失敗したときに戻る先を決める純関数。
// 押してから通信が返るまでの見え方は、サーバー側の keep ルートと同じ規則にする
// （記録が無ければ間隔1日で新規、あれば removedAt だけを外す）。ずれると、
// 保存が成功したのに画面の数字が一瞬だけ違う、という見え方になる。
import { newProgress } from './srs'
import { normalizePageId } from './claim-text'
import type { RecallProgress, RecallSectionRead } from './types'

export function keepOptimistic(
  list: RecallProgress[], claimId: string, keep: boolean, now: Date,
): RecallProgress[] {
  const found = list.find((p) => p.claimId === claimId)
  const rest = list.filter((p) => p.claimId !== claimId)
  if (keep) {
    const next = found ? { ...found, removedAt: null } : newProgress(claimId, now)
    return [...rest, next]
  }
  // 残していない主張は外せない（サーバーも404を返す）。画面も何も変えない。
  if (!found) return list
  return [...rest, { ...found, removedAt: now.toISOString() }]
}

export function replaceProgress(list: RecallProgress[], row: RecallProgress): RecallProgress[] {
  return [...list.filter((p) => p.claimId !== row.claimId), row]
}

export function readOptimistic(
  list: RecallSectionRead[], pageId: string, sectionKey: string, now: Date,
): RecallSectionRead[] {
  // 記録側（/api/recall/read）が normalizePageId を通して保存するので、画面側も同じ形で持つ。
  // 揃えないと、いま押した節が「読んだ」に見えないまま残る。
  const id = normalizePageId(pageId)
  const rest = list.filter((r) => !(r.pageId === id && r.sectionKey === sectionKey))
  return [...rest, { pageId: id, sectionKey, readAt: now.toISOString() }]
}

export function removeRead(
  list: RecallSectionRead[], pageId: string, sectionKey: string,
): RecallSectionRead[] {
  const id = normalizePageId(pageId)
  return list.filter((r) => !(r.pageId === id && r.sectionKey === sectionKey))
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/__tests__/recall-optimistic.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/optimistic.ts src/lib/__tests__/recall-optimistic.test.ts
git commit -m "feat(recall): 楽観反映と巻き戻しの純関数"
```

---

### Task 5: RecallProvider（在庫を1か所にする）

**即時反映の要。**読む画面と Recall 画面が同じ配列を見るので、「反映する」処理を書かなくても映る。

**Files:**
- Create: `src/components/recall/RecallProvider.tsx`
- Modify: `src/app/page.tsx`（3か所の `<ReaderMarksProvider>` の外側に置く）
- Modify: `src/components/recall/useRecallData.ts`

**Interfaces:**
- Consumes: Task 4 の4関数、`isRecallEnabled()`（`recall-flag.ts`）
- Produces:

```ts
export type UndoState = { claimId: string; label: string } | null
export type RecallStore = {
  enabled: boolean
  loading: boolean
  error: string | null
  saveError: string | null
  clearSaveError: () => void
  claims: RecallClaim[]
  progress: RecallProgress[]
  reads: RecallSectionRead[]
  pending: Set<string>            // 保存中の claimId と `read:${pageId}#${sectionKey}`
  keep: (claimId: string, keep: boolean) => Promise<void>
  review: (claimId: string, result: 'ok' | 'ng') => Promise<void>
  markSectionRead: (pageId: string, sectionKey: string) => Promise<void>
  refresh: () => Promise<void>
}
export function useRecallStore(): RecallStore
export function RecallProvider({ children }: { children: React.ReactNode }): JSX.Element
```

- [ ] **Step 1: Provider を作る**

`useRecallData.ts` の現行の取得ロジック（`createGate` / `refresh` / `aliveRef` / `abortRef` / `TICK_MS` 以外の保存部分）を**そのまま移す**。移すときに変えるのは次の3点だけ。

1. `save()` を楽観方式にする（先に画面を変え、失敗したら戻す）
2. `markSectionRead()` を足す
3. 取り消しトーストの状態と8秒のタイマーを持つ

```tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import { keepOptimistic, replaceProgress, readOptimistic, removeRead } from '@/lib/recall/optimistic'
import { isRecallEnabled } from '@/lib/recall-flag'

// 取り消しを出しておく時間。走りながら片手で押す前提なので、通知として短すぎない長さにする。
const UNDO_MS = 8000

export type RecallStore = {
  enabled: boolean
  loading: boolean
  error: string | null
  saveError: string | null
  clearSaveError: () => void
  claims: RecallClaim[]
  progress: RecallProgress[]
  reads: RecallSectionRead[]
  // 保存中の鍵。主張は claimId、節は `read:${pageId}#${sectionKey}`。
  pending: Set<string>
  keep: (claimId: string, keep: boolean) => Promise<void>
  review: (claimId: string, result: 'ok' | 'ng') => Promise<void>
  markSectionRead: (pageId: string, sectionKey: string) => Promise<void>
  refresh: () => Promise<void>
}

/* 反映の順番を守る門。useRecallData から移設（説明もそのまま）。 */
type Gate = { issue: () => number; isLatest: (id: number) => boolean }
function createGate(): Gate {
  let seq = 0
  return { issue: () => ++seq, isLatest: (id: number) => id === seq }
}

const Ctx = createContext<RecallStore | null>(null)

// 機能が閉じている利用者・Provider の外では、何も持たない在庫を返す。
// 呼び出し側が enabled を見ずに書いても、通信も描画も起きない。
const EMPTY: RecallStore = {
  enabled: false, loading: false, error: null, saveError: null, clearSaveError: () => {},
  claims: [], progress: [], reads: [], pending: new Set(),
  keep: async () => {}, review: async () => {}, markSectionRead: async () => {}, refresh: async () => {},
}

export function useRecallStore(): RecallStore {
  return useContext(Ctx) ?? EMPTY
}

export function RecallProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<RecallClaim[]>([])
  const [progress, setProgress] = useState<RecallProgress[]>([])
  const [reads, setReads] = useState<RecallSectionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [undo, setUndo] = useState<{ claimId: string } | null>(null)
  const enabled = isRecallEnabled()

  const gateRef = useRef<Gate | null>(null)
  if (!gateRef.current) gateRef.current = createGate()
  const aliveRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mark = useCallback((key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // refresh は現行 useRecallData の実装をそのまま移す（404 は静かに空で終える／
  // 打ち切りは失敗にしない／スピナーは最初の1回だけ）。
  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    const gate = gateRef.current!
    const id = gate.issue()
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const usable = () => aliveRef.current && gate.isLatest(id)
    try {
      const [c, p] = await Promise.all([
        fetch('/api/recall/claims', { signal: ac.signal }),
        fetch('/api/recall/progress', { signal: ac.signal }),
      ])
      if (c.status === 404 || p.status === 404) {
        if (!usable()) return
        setClaims([]); setProgress([]); setReads([]); setError(null)
        return
      }
      if (!c.ok || !p.ok) throw new Error('読み込みに失敗しました')
      const cj = (await c.json()) as { claims: RecallClaim[] }
      const pj = (await p.json()) as { progress: RecallProgress[]; reads: RecallSectionRead[] }
      if (!usable()) return
      setClaims(cj.claims); setProgress(pj.progress); setReads(pj.reads); setError(null)
    } catch (e) {
      if (ac.signal.aborted || !usable()) return
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally {
      if (aliveRef.current && !ac.signal.aborted) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
      abortRef.current?.abort()
      if (undoTimer.current) clearTimeout(undoTimer.current)
    }
  }, [refresh])

  // 「記憶の残り」を時間で進めるのは導出側（useRecallData）の仕事。Provider は在庫だけを持つ。

  const keep = useCallback(async (claimId: string, keepIt: boolean) => {
    const before = progress
    const at = new Date()
    setProgress((prev) => keepOptimistic(prev, claimId, keepIt, at))
    mark(claimId, true)
    try {
      const res = await fetch('/api/recall/keep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, keep: keepIt }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      const { progress: row } = (await res.json()) as { progress: RecallProgress }
      if (!aliveRef.current) return
      gateRef.current!.issue()
      setProgress((prev) => replaceProgress(prev, row))
      setSaveError(null)
      // 残したときだけ取り消しを出す。外したときは出さない（もう一度押せば戻るため）。
      if (keepIt) {
        if (undoTimer.current) clearTimeout(undoTimer.current)
        setUndo({ claimId })
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
      } else {
        setUndo(null)
      }
    } catch (e) {
      // 押す前の一覧へ戻す。押したことが無かったのと同じ状態にする。
      if (aliveRef.current) {
        setProgress(before)
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    } finally {
      mark(claimId, false)
    }
  }, [progress, mark])

  const review = useCallback(async (claimId: string, result: 'ok' | 'ng') => {
    const before = progress
    mark(claimId, true)
    try {
      const res = await fetch('/api/recall/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, result }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      const { progress: row } = (await res.json()) as { progress: RecallProgress }
      if (!aliveRef.current) return
      gateRef.current!.issue()
      setProgress((prev) => replaceProgress(prev, row))
      setSaveError(null)
    } catch (e) {
      if (aliveRef.current) {
        setProgress(before)
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    } finally {
      mark(claimId, false)
    }
  }, [progress, mark])

  const markSectionRead = useCallback(async (pageId: string, sectionKey: string) => {
    const key = `read:${pageId}#${sectionKey}`
    const at = new Date()
    setReads((prev) => readOptimistic(prev, pageId, sectionKey, at))
    mark(key, true)
    try {
      const res = await fetch('/api/recall/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, sectionKey }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      if (aliveRef.current) setSaveError(null)
    } catch (e) {
      if (aliveRef.current) {
        setReads((prev) => removeRead(prev, pageId, sectionKey))
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    } finally {
      mark(key, false)
    }
  }, [mark])

  const clearSaveError = useCallback(() => setSaveError(null), [])

  const value = useMemo<RecallStore>(() => ({
    enabled, loading, error, saveError, clearSaveError,
    claims, progress, reads, pending, keep, review, markSectionRead, refresh,
  }), [enabled, loading, error, saveError, clearSaveError, claims, progress, reads, pending, keep, review, markSectionRead, refresh])

  return (
    <Ctx.Provider value={value}>
      {children}
      {undo && (
        // 取り消しは画面下の1行。カード・モーダルは開かない（読書を止めない）。
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-[86px] z-40 flex items-center gap-3 rounded-full border border-brand-500/40 bg-white/95 dark:bg-gray-800/95 px-4 py-2 text-xs text-gray-700 dark:text-gray-200 shadow-lg"
        >
          <span>Recall に残しました</span>
          <button
            type="button"
            className="font-bold text-brand-700 dark:text-brand-300 min-h-[32px] px-1"
            onClick={() => { const id = undo.claimId; setUndo(null); void keep(id, false) }}
          >
            取り消す
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}
```

- [ ] **Step 2: `page.tsx` の3か所に置く**

`import { RecallProvider } from '@/components/recall/RecallProvider'` を足し、3つの `<ReaderMarksProvider>` それぞれの外側を `<RecallProvider>` で包む（閉じタグも対応させる）。

```tsx
<RecallProvider>
  <ReaderMarksProvider>
    <ReaderProvider>
      ...
    </ReaderProvider>
  </ReaderMarksProvider>
</RecallProvider>
```

- [ ] **Step 3: `useRecallData.ts` を在庫の利用側にする**

`claims` / `progress` / `reads` / `loading` / `error` / `saveError` / `clearSaveError` / `keep` / `review` / `refresh` を自前で持つのをやめ、`useRecallStore()` から受ける。**残すのは導出だけ**（`positions` / `strands` / `progressById` / `readSet` / `phaseById` / `sprites` / `marks` / `counts` / `openable` / `candidates` / `due`）と、`now` の1分ごとの更新。返り値の形は変えない（`RecallScreen.tsx` は無変更）。

```ts
export function useRecallData() {
  const store = useRecallStore()
  const { claims, progress, reads, loading, error, saveError, clearSaveError, keep, review, refresh } = store
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  // 保存のたびに「記憶の残り」を計算し直すため、progress が変わったら now も進める。
  useEffect(() => { setNow(new Date()) }, [progress])
  /* ── 以下、現行の useMemo 群をそのまま残す ── */
}
```

- [ ] **Step 4: 既存のフックのテストを差し替える**

`recall-data-hook.test.ts` は fetch を URL で振り分けて hook を回している。取得の担当が Provider へ移ったので、次のように分ける。

このテストは DOM を使わない自作のミニ React で実物のフックを回している。取得の担当が Provider へ移ったので、次のように分ける。

- **導出だけを見る検査**（粒の状態・候補・期限・内訳）は残す。`useRecallStore` を `vi.mock('@/components/recall/RecallProvider', ...)` で差し替え、`claims` / `progress` / `reads` を直接与える形に書き換える
- **取得と保存の順番を見る3件**（404 で静かに空になる／読み込み中の保存が巻き戻らない／保存の失敗が読み込みエラーを覆わない）は、フックからは検査できなくなる。**うち2件は `optimistic.ts` のテストが担う**（巻き戻しの正しさ・元配列を壊さないこと）。残る「404 で静かに空になる」と「順番の門」は、Task 10 の実機確認（項目9・12）で見る
- 差し替えの理由をテストファイルの冒頭コメントに残す（次に読む人が「検査が減った」と誤解しないため）

- [ ] **Step 5: 型検査とテスト全体を通す**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 型エラー0件、テスト全件 PASS

- [ ] **Step 6: コミット**

```bash
git add src/components/recall/RecallProvider.tsx src/components/recall/useRecallData.ts src/app/page.tsx src/lib/__tests__/recall-data-hook.test.ts
git commit -m "feat(recall): 在庫を Provider に集め、保存を楽観反映にする"
```

---

### Task 6: 本文行末の Node

**Files:**
- Create: `src/components/reader/RecallNode.tsx`
- Test: 純関数が無いのでテストは書かない（実機確認で見る。Task 10 の項目）

**Interfaces:**
- Consumes: `useRecallStore()`（Task 5）、`RecallClaim`
- Produces: `<RecallNode claim={claim} />`

- [ ] **Step 1: 作る**

```tsx
'use client'
// 本文行末の丸い Node。空洞＝まだ残していない、塗り＝残した。
// 見た目は本文の字に合わせて 1.05em（実測 約15px）だが、当たり判定は 44px 四方を確保する
// （走りながら片手で押す前提。見た目を大きくすると本文の読みを壊す）。
import { useRecallStore } from '@/components/recall/RecallProvider'
import type { RecallClaim } from '@/lib/recall/types'

export function RecallNode({ claim }: { claim: RecallClaim }) {
  const { progress, pending, keep } = useRecallStore()
  const row = progress.find((p) => p.claimId === claim.claimId)
  const kept = !!row && !row.removedAt
  const busy = pending.has(claim.claimId)

  return (
    <span className="relative inline-flex items-center align-[-0.2em] ml-1">
      <button
        type="button"
        aria-pressed={kept}
        aria-busy={busy || undefined}
        aria-label={kept ? 'この主張を残すのをやめる' : 'この主張を残す'}
        disabled={busy}
        onClick={() => { void keep(claim.claimId, !kept) }}
        className={`inline-flex h-[1.05em] w-[1.05em] items-center justify-center rounded-full border-[1.6px] border-brand-600 dark:border-brand-400 transition-colors motion-reduce:transition-none ${
          kept ? 'bg-brand-600 dark:bg-brand-400 shadow-[0_0_0_3px_rgba(25,107,79,0.16)]' : 'bg-transparent'
        } ${busy ? 'opacity-50' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-brand-600`}
      >
        {/* 当たり判定だけを 44px に広げる。見た目の丸は上の border が描く。 */}
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2" />
      </button>
    </span>
  )
}
```

- [ ] **Step 2: 型検査**

Run: `npx tsc --noEmit`
Expected: 型エラー0件

- [ ] **Step 3: コミット**

```bash
git add src/components/reader/RecallNode.tsx
git commit -m "feat(reader): 本文行末の Node（当たり判定44px）"
```

---

### Task 7: 節末の「この節を読んだ」ボタン

**Files:**
- Create: `src/components/reader/SectionReadButton.tsx`

- [ ] **Step 1: 作る**

```tsx
'use client'
// 節末の明示ボタン。スクロールでの自動判定はしない（2026-09-03 オーナー決定）。
// 押した後も押し戻せる操作は置かない（読んだ記録は消す対象ではない）。
import { useRecallStore } from '@/components/recall/RecallProvider'
import { normalizePageId } from '@/lib/recall/claim-text'

export function SectionReadButton({ pageId, sectionKey }: { pageId: string; sectionKey: string }) {
  const { reads, pending, markSectionRead } = useRecallStore()
  const id = normalizePageId(pageId)
  const done = reads.some((r) => r.pageId === id && r.sectionKey === sectionKey)
  const busy = pending.has(`read:${pageId}#${sectionKey}`)

  if (done) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gray-400/60" />
        この節を読みました
      </p>
    )
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => { void markSectionRead(pageId, sectionKey) }}
      className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dashed border-brand-500/40 bg-brand-50/60 dark:bg-brand-900/20 px-4 text-xs font-bold text-brand-800 dark:text-brand-200 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {busy ? '記録しています' : 'この節を読んだ'}
    </button>
  )
}
```

- [ ] **Step 2: 型検査してコミット**

```bash
npx tsc --noEmit
git add src/components/reader/SectionReadButton.tsx
git commit -m "feat(reader): 節末の「この節を読んだ」ボタン"
```

---

### Task 8: 読む画面に組み込む（ReaderBody）

`RenderedBlocks` は `ReaderBody` と `ReaderSpread`（節の深掘り）の**両方**が使う。ここに1回置けば両方に出る。

**Files:**
- Modify: `src/components/reader/ReaderBody.tsx`

- [ ] **Step 0: import を足す**

```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'  // createContext / useContext を追加
import { buildClaimIndex, claimForRowText, sectionEnds } from '@/lib/recall/reader-claims'
import { useRecallStore } from '@/components/recall/RecallProvider'
import { RecallNode } from './RecallNode'
import { SectionReadButton } from './SectionReadButton'
```

- [ ] **Step 1: ページIDと節キーを渡す入れ物を足す**

`ReaderBody.tsx` の先頭付近に置く（新しいファイルを作らず、使う側と同じ場所に置く）。

```tsx
// 本文の描画に「いまどのページ・どの節か」を伝える。Node と節末ボタンだけが使う。
// pageId が空文字のときは Recall の部品を一切描かない（個人・部署リーダー・dev ハーネス）。
export const ReaderRecallCtx = createContext<{ pageId: string; sectionKey: string }>({ pageId: '', sectionKey: 'sec0' })
```

- [ ] **Step 2: `groupBlocks` が元の位置を落とさないようにする**

現在 `ListGroup` は先頭の `index` しか持たず、項目ごとの元位置が失われている。節キーを項目ごとに引くために `indices` を足す。

```ts
type ListGroup = { kind: 'list'; ordered: boolean; items: ReaderInline[][]; index: number; indices: number[] }

function groupBlocks(blocks: ReaderBlock[]): Grouped[] {
  const out: Grouped[] = []
  blocks.forEach((b, idx) => {
    if (b.kind === 'list_item') {
      const last = out[out.length - 1]
      if (last && last.kind === 'list' && last.ordered === b.ordered) {
        last.items.push(b.inlines); last.indices.push(idx)
      } else {
        out.push({ kind: 'list', ordered: b.ordered, items: [b.inlines], index: idx, indices: [idx] })
      }
    } else {
      out.push({ kind: 'item', block: b, index: idx })
    }
  })
  return out
}
```

- [ ] **Step 3: `RenderedBlocks` の `li` に Node を足し、節末にボタンを置く**

```tsx
export function RenderedBlocks({ blocks, onImageClick, active, offset = 0 }: { /* 現行のまま */ }) {
  const grouped = groupBlocks(blocks)
  const { pageId, sectionKey: ctxSection } = useContext(ReaderRecallCtx)
  const { enabled, claims } = useRecallStore()
  const on = enabled && !!pageId
  // 索引はページが変わるまで作り直さない（687件の走査を毎描画で回さない）。
  const index = useMemo(() => (on ? buildClaimIndex(claims, pageId) : null), [on, claims, pageId])
  // 節末ボタンを置くのは1本描き（Ctx が sec0＝節の区切りを自分で探す側）のときだけ。
  // スプレッドは節ごとに <section> を持ち、そちらが自分でボタンを置く（二重に出さない）。
  // 節キーは claim 自身が持つので、Node の側では要らない。
  const ends = useMemo(() => (on && ctxSection === 'sec0' ? sectionEnds(blocks) : []), [on, ctxSection, blocks])
  const endAt = (i: number) => ends.find((e) => e.afterIndex === i) ?? null

  return (
    <>
      {grouped.map((g, i) => {
        if (g.kind === 'list') {
          const Tag = g.ordered ? 'ol' : 'ul'
          const last = g.indices[g.indices.length - 1]
          return (
            <div key={i}>
              <Tag className={`${g.ordered ? 'list-decimal' : 'list-disc'} pl-5 my-4 space-y-2.5`}>
                {g.items.map((it, j) => {
                  const pseudo: ReaderBlock = { kind: 'list_item', ordered: g.ordered, inlines: it }
                  const color = textColorClass(pseudo, active)
                  // 行の生テキスト（マークは絵文字のまま）。Inlines が線画へ置き換える前の姿を使う。
                  const claim = index ? claimForRowText(index, it.map((x) => x.text).join('')) : null
                  return (
                    <li key={j} className={`leading-[1.9] whitespace-pre-line break-words transition-colors duration-150 motion-reduce:transition-none ${color}`}>
                      <Inlines items={it} k={`li-${i}-${j}`} />
                      {claim && <RecallNode claim={claim} />}
                    </li>
                  )
                })}
              </Tag>
              {endAt(last) && <SectionReadButton pageId={pageId} sectionKey={endAt(last)!.sectionKey} />}
            </div>
          )
        }
        const end = endAt(g.index)
        return (
          <div key={i}>
            <Block block={g.block} index={offset + g.index} onImageClick={onImageClick} active={active} />
            {end && <SectionReadButton pageId={pageId} sectionKey={end.sectionKey} />}
          </div>
        )
      })}
    </>
  )
}
```

`sectionAt` は Node 側では使わない（claim が自分の `sectionKey` を持っているため）。節末ボタンの位置決めにだけ `ends` を使う。**未使用の `sectionAt` は書かない**（上の実装から削ること）。

- [ ] **Step 4: `ReaderBody` が Ctx を張る**

```tsx
export function ReaderBody({ doc, onImageClick, active, scaleEm, mode, owner, pageId = '' }: {
  /* 既存の props に1つ足す */ pageId?: string
}) {
  /* ... 既存のまま ... */
  return (
    <ReaderRecallCtx.Provider value={{ pageId, sectionKey: 'sec0' }}>
      <ReaderSourceCtx.Provider value={source}>
        {/* 既存の中身 */}
      </ReaderSourceCtx.Provider>
    </ReaderRecallCtx.Provider>
  )
}
```

- [ ] **Step 5: `ReaderOverlay` から `pageId` を渡す**

`ReaderOverlay` が `<ReaderBody ... />` を描いている箇所に `pageId={canonicalPageId(hit.objectID)}` を足す（`canonicalPageId` は `@/lib/reader-spread` から既に import 済みか確認し、無ければ足す）。

- [ ] **Step 6: 型検査**

Run: `npx tsc --noEmit`
Expected: 型エラー0件

- [ ] **Step 7: コミット**

```bash
git add src/components/reader/ReaderBody.tsx src/components/reader/ReaderOverlay.tsx
git commit -m "feat(reader): 本文の主張行に Node、節末に読んだボタンを置く"
```

---

### Task 9: スプレッドに組み込む

**Files:**
- Modify: `src/components/reader/spread/ReaderSpread.tsx`

- [ ] **Step 1: 節ごとに Ctx を張る**

`spread.sections.map((s, i) => ...)` の `<section>` の中身を `ReaderRecallCtx.Provider` で包む。節キーは `s.n` から作る。

```tsx
<section key={s.anchor} className={styles.section}>
  <ReaderRecallCtx.Provider value={{ pageId, sectionKey: s.n != null ? `sec${s.n}` : 'sec0' }}>
    {/* 既存の中身すべて */}
    {/* 節末（問いの箱の後）に置く。節キーが sec0 のときは出さない。 */}
    {s.n != null && <SectionReadButton pageId={pageId} sectionKey={`sec${s.n}`} />}
  </ReaderRecallCtx.Provider>
</section>
```

`pageId` は `spread.pageId` をそのまま使う（`SpreadDoc.pageId` は既に正準形）。

- [ ] **Step 2: 型検査**

Run: `npx tsc --noEmit`
Expected: 型エラー0件

- [ ] **Step 3: コミット**

```bash
git add src/components/reader/spread/ReaderSpread.tsx
git commit -m "feat(reader): スプレッドの節に Node と読んだボタンを通す"
```

---

### Task 10: 全体の検査

- [ ] **Step 1: 全テスト**

Run: `npx vitest run`
Expected: 全件 PASS

- [ ] **Step 2: 型とビルド**

Run: `npx tsc --noEmit && npm run build`
Expected: どちらもエラー0件

- [ ] **Step 3: 実機確認（Task 10 の一覧を上から順に）**

- [ ] **Step 4: コミット（必要なら）**

---

## 3. 状態管理と即時反映の方法

**採る方式: React Context の在庫（`RecallProvider`）を1つ置き、読む画面と Recall 画面の両方がそれを見る。**

理由は3つです。

1. **反映の処理を書かなくてよい。** リーダーのオーバレイは Recall タブの上に重なるだけで、Recall 画面はマウントされたまま残ります。イベントを飛ばして再取得させる方式だと、飛ばし忘れた経路が静かに壊れます。同じ配列を見ていれば、書いた瞬間に両方が変わります
2. **主張の一覧を何度も取りに行かない。** 687件の取得が、リーダーを開くたびに走らずに済みます
3. **既存の競合対策を捨てない。** 現行 `useRecallData` の順番の門（`createGate`）と打ち切り処理をそのまま Provider へ移すので、読み込みと保存の割り込みに対する防御が消えません

**採らなかった方式:** `window` のカスタムイベントで Recall 画面に再取得させる方式。変更は小さいですが、リーダー側が主張の一覧を別に取ることになり、在庫が2つになります。

**Recall 画面の変更はありません。** `useRecallData` の返り値の形を変えないので、`RecallScreen.tsx` は無変更です。

---

## 4. 楽観的UIの成功・失敗・取り消しの挙動

| 経路 | 画面 | 記録 |
|---|---|---|
| 押した瞬間 | Node が塗りに変わる。件数も即座に増える。ボタンは押せない状態（`aria-busy`） | まだ何も送っていない |
| 成功 | サーバーが返した行で置き換える（`kept_at`・`due_at` が本物の値になる）。画面下に「Recall に残しました／取り消す」を8秒 | `recall_progress` に1行 |
| 失敗 | 押す前の一覧へ戻す。Node は空洞に戻る。「保存に失敗しました」を出す（画面全体は覆わない） | 何も残らない |
| 取り消し | トーストの「取り消す」で `keep(claimId, false)` を送る。Node は空洞に戻る | `removed_at` が立つ（行は消えない＝再開の履歴を保つ） |
| 外す | Node は空洞に戻る。**トーストは出さない**（もう一度押せば戻るため） | `removed_at` が立つ |

**巻き戻しは配列まるごとを差し替える方式にします。**1行だけを戻す方式だと、押した直後に別の行を押したときにどちらを戻すかが決まりません。

**「この節を読んだ」も同じ形**です。押した瞬間に「この節を読みました」に変わり、失敗したらボタンに戻ります。取り消しは置きません（読んだ記録は消す対象ではないため）。

---

## 5. claim と本文行の対応方法

**クライアントでハッシュを作りません。**（オーナーの技術的提案を採用）

1. `/api/recall/claims` が返す確定済みの主張（`claimId` 付き）を Provider が持つ
2. 開いているページの主張だけで索引を作る（正規化した本文 → 主張）
3. 本文行のテキストを、同期側とまったく同じ `splitClaim` に通して本文部分を取り出す
4. 正規化して索引を引く。**見つかった行にだけ Node を出す**

**この方式の性質**

- 新しいIDを作りません。`claimId` はサーバーが確定した値をそのまま使います
- ハッシュの実装がサーバーとクライアントでずれる余地がありません
- 取りこぼしたときの壊れ方は「Node が出ない」だけです。別の主張に付くことはありません（索引は完全一致）
- 未同期の主張・除外対象（❓の行・⚡結論・署名）には Node が出ません。索引に無いためです

**Web Crypto での再実装との比較（採らなかった理由）**

| | 索引方式（採用） | Web Crypto 方式 |
|---|---|---|
| 新しいID | 作らない | 作らない |
| サーバーとのずれ | 起きない（サーバーの値をそのまま使う） | `normalizeBody` の実装が将来ずれると、同じ文が別IDになる |
| 通信 | 既存の `claims` 取得を使い回す | 同じく `claims` が要る（一覧に無い行には Node を出さないため） |
| 計算 | 完全一致1回 | sha1 が非同期（`subtle.digest`）。行ごとに `await` が要る |

Web Crypto 方式は**通信量が減るわけでもないのに、ずれる余地だけが増えます**。索引方式を採ります。

---

## 6. 「この節を読んだ」の処理

- **置く場所:** 節の末尾。スプレッドでは「この節から生まれた問い」の箱の後。1本描きのリーダーでは、その節の最後のブロックの直後
- **節キー:** 番号付き H2 から `sec{n}`。同期側の `SECTION_HEAD_RE` と同じ正規表現を共有します（`claim-text.ts`）
- **`sec0` には置きません。** 最初の見出しより前は ⚡結論・署名・大前提で、節ではありません
- **自動判定はしません。** スクロール・滞在時間は見ません（2026-09-03 オーナー決定）
- **押し戻す操作は置きません。** 押した後は「この節を読みました」の1行に変わります
- **送るページIDは正準形**（ダッシュ無し・小文字32桁）。サーバー側も `normalizePageId` を通すので二重に安全です

---

## 7. UIの全状態

### Node（本文行末）

| 状態 | 条件 | 見え方 |
|---|---|---|
| 描かない | 機能が閉じている／`pageId` が空／索引に無い行 | 何も出ない |
| まだ | 記録が無い、または `removed_at` あり | 空洞（枠だけ） |
| 残した | 記録あり・`removed_at` なし | 塗り＋淡い輪 |
| 保存中 | `pending` に claimId | 半透明・押せない・`aria-busy` |

### 節末ボタン

| 状態 | 見え方 |
|---|---|
| 未 | 「この節を読んだ」（破線の枠・最低44px） |
| 保存中 | 「記録しています」・押せない |
| 済 | 「この節を読みました」の1行（ボタンではない） |
| 描かない | 機能が閉じている／`sec0` |

### 取り消しトースト

| 状態 | 見え方 |
|---|---|
| 出る | 「残す」が成功した直後・8秒間 |
| 出ない | 「外す」のとき／保存に失敗したとき |
| 押した | 消えて、外す操作が走る |

### 保存の失敗

画面下の1行で「保存に失敗しました」。**画面全体を覆う知らせは出しません**（現行の `saveError` と `error` の切り分けをそのまま守る）。次に成功した操作で消えます。

---

## 8. エラー時の挙動

| 起きること | 振る舞い |
|---|---|
| 機能が閉じている（404） | claims・progress とも静かに空。Node も節末ボタンも描かない。「Recall」という語を1文字も出さない |
| 未ログイン（401） | 読み込みエラーとして扱う。Recall の部品は描かれない |
| 保存が失敗（通信断・500） | 押す前の状態へ戻し、1行の知らせを出す。読書は続けられる |
| オフライン | 保存は失敗として扱う。**再送キューは作らない**（部品1の範囲外） |
| 主張の一覧が上限で切られた | 現行の `warnIfClaimsTruncated` がサーバー側のログに残す。索引に入らない行には Node が出ない |
| 同じ行を連打 | `pending` の間はボタンを無効にするので二重送信しない |
| 読み込み中に保存が割り込む | Provider の順番の門（`createGate`）が、古い読み込みの応答で新しい保存を巻き戻さないようにする |

---

## 9. 追加・変更するテスト

| ファイル | 検査 |
|---|---|
| `recall-reader-claims.test.ts`（新・4件） | 実データ700粒での引き当て率9割超／主張でない行に何も返さない／別ページを混ぜない／異体字の吸収 |
| `recall-reader-sections.test.ts`（新・5件） | 節キーの導出3件／節末の位置2件 |
| `recall-optimistic.test.ts`（新・8件） | 残す・外す・残し直しの楽観反映／元配列を壊さない／サーバーの答えでの置き換え／読んだの重複と巻き戻し |
| `recall-extract-claims.test.ts`（既存・無変更で通ること） | 切り出しで振る舞いが変わっていないことの回帰 |
| `recall-sync-claims.test.ts`（既存・無変更で通ること） | 同上 |
| `recall-data-hook.test.ts`（更新） | 取得の検査を Provider 側の担当へ移し、導出の検査だけを残す |

**コンポーネントのテストは書きません。**このリポジトリには jsdom も testing-library も入っておらず、部品1のために描画テストの土台を入れるのは範囲外です。描画は実機確認で見ます。

---

## 10. 実機で確認する項目

ブラウザペインは**表示状態**にして確認します（非表示だとタイマーが間引かれ、トーストの8秒が伸びます）。

1. 公開中のスプレッド1本を開き、「この節の根拠を見る」を開いて、主張行の末尾に Node が出ることを見る
2. Node を押す。**待ち時間なく**塗りに変わることを見る（楽観反映が効いている）
3. 画面下に「Recall に残しました／取り消す」が出て、8秒で消えることを見る
4. もう一度残して、今度は「取り消す」を押す。Node が空洞に戻ることを見る
5. リーダーを閉じ、Recall タブを開く。**再読み込みなしで**その主張が明るく灯っていることを見る（即時反映）
6. Recall タブを開いたままリーダーを開き、残す。閉じたときに球が変わっていることを見る（マウントされたままの経路）
7. 節末の「この節を読んだ」を押す。「この節を読みました」に変わることを見る
8. Recall タブで、その節の主張が「読んだ」の色で灯っていることを見る
9. 機内モードにして Node を押す。「保存に失敗しました」が出て、Node が空洞に戻ることを見る
10. **iPhone 実機**で Node を押す。親指で1回で押せるかを見る（44px の当たり判定）
11. 1本描きのリーダー（スプレッドが無いページ）でも同じことを見る
12. `RECALL_EMAILS` に入っていないアカウントで同じページを開き、**Node も節末ボタンも1つも出ない**ことを見る
13. 文字サイズを Aa で最大にして、Node が本文の行を壊さないことを見る
14. ダークモードで Node の空洞と塗りが見分けられることを見る
15. 「動きを減らす」設定で、Node の色の変化が即時になることを見る

---

## 11. 部品1に含めないこと（オーナー決定のとおり）

- Recall の3段階評価
- 記事末尾の保存件数まとめ／記事末尾からの即時復習
- 段落の ✅ 行を新たに主張として抽出する変更（**索引に無い行には Node を出さない**方式で、この論点に触れずに済ませる）
- オフライン時の再送キュー
- 改訂理由の記録／旧Nodeと新Nodeの対応表
- 保存済み行の左罫線・背景色
- Recall の一般公開
- SRS アルゴリズムの変更
- 「残す」の一括操作
- 端末ローカルの読了水位との統合
- Notion への落とし（部品4）

### 別課題として記録（部品1に混ぜない・公開前の必須条件）

**`/api/recall/claims` にプレミアム判定がありません。**

- 現物: `src/lib/recall/guard.ts:37` の `requireRecall()` は `sessionHasFeature('recall')` とログインだけを見ています。リーダーの `/api/subscription/page` は `requirePremiumRequest` を通しているのに、主張の本文（有料）を返すこのAPIは通していません
- いまの実害: ありません。`recall` はオーナー1人にしか開いていません
- **公開前に必ず塞ぐこと。** `RECALL_GA=true` を置く判断と同じ作業として扱います
- 記録先: このファイルのこの節と、[Recall 定着エンジン設計](../specs/2026-09-02-recall-engine-design.md) の「公開の段階と再検討ライン」の表。**部品6（今日の1問の撤去）でも公開判断に触れるので、そこでも確認する**

---

## 12. 実装を開始する前にオーナーが判断すべき残存事項

| # | 論点 | 選択肢 | 影響 |
|---|---|---|---|
| 1 | **着手条件を満たす操作**（必須） | Recall タブで「残す」を1回・翌日「覚えた」を1回押す | 押さないと `recall_progress` が0行のまま。部品1の着手条件が満たされない |
| 2 | **スプレッドでは主張行が既定で畳まれている** | (a) そのまま。「この節の根拠を見る」を開いた人だけが残せる (b) 主張行を含む節を既定で開く | (b) にすると公開中の4本の見え方が変わる。パイロット版の完成度に触れる |
| 3 | **期限が来ている主張に、読む画面でも淡い輪を出すか** | (a) 出す（比較見本の4状態のうち3つ目） (b) 部品1では出さない | 計算は既存の関数で済む。出すと読む画面に復習の圧が入る |
| 4 | **取り消しの表示時間** | 8秒（案） | 短いと押せない。長いと読書の邪魔になる |
| 5 | **cloze の承認が0件** | (a) 部品1と別に `/admin` で承認する (b) 当面すべて想起カードのまま | 一周の体験が変わる（伏せ字カードを一度も見ないまま判断することになる） |

**2番は見え方の判断なので、実装前に決めてください。**残り4つは実装中に決めても手戻りが出ません。

---

## 実行方法の選択

計画は `docs/superpowers/plans/2026-09-03-reader-keep-and-read-plan.md` に保存しました。実行は2通りあります。

1. **サブエージェント方式（推奨）** … 1タスクごとに新しいサブエージェントを割り当て、タスクの間にレビューを挟む
2. **このセッションで直接実行** … まとめて進め、区切りごとに確認する

どちらでも、worktree を切ってから始めます（現在の作業ツリーは別セッションの `feat/genre-seats-37` のため）。
