# 聞ける棚 段0＋段2 実装計画（部品3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 疑問が棚に当たり、無ければ依頼になり、正本になって通知で戻る経路を、オーナー専用のフラグの内側で本番に通す。

**Architecture:** 段0は `recall_claims` を3層（主張→節・記事→板の近い疑問）で引く。順位と足切りは TypeScript の純関数「覆い率」が決め、PGroonga は候補を絞るためだけに使う（無効でも全件読みで同じ結果になる）。段2は既存の受付DBに列を4つ足し、利用者に見える状態を4つにする。正本主張IDは /admin から書き、通知 cron が主張＞節＞記事の順で最も具体的な場所へ飛ばす。

**Tech Stack:** Next.js App Router / TypeScript / Supabase (Postgres, RLS) / Notion API / Algolia / vitest / Web Push (web-push) / Resend

## Global Constraints

- **公開リポジトリである。** 事業数値（登録者数・課金数・売上・コスト）をコード・コミット文・PR・コメントに書かない。有料のサブスク本文（主張の本文を含む）をリポジトリにコミットしない。実データの固定資産は `.gitignore` 済みの `.preview/` に置く
- **機能フラグは `ask_shelf`。専用の許可メール `ASK_SHELF_EMAILS` のみ。フォールバック無し。GA env は公開判断まで置かない**（`recall` と同型）
- **判定の正はサーバー。** 段0・依頼の各 API は処理を始める前に `hasFeature('ask_shelf', …)` を通す。UI を隠すだけにしない
- **主張の鍵は `claimIdOf(pageId, body)` の1つだけ**（`src/lib/recall/extract-claims.ts`。sha1 先頭24文字）。新しい ID を作らない
- **「残した」の記録は `recall_progress` の1本だけ。** 段0からも通知からも同じ表に書く
- **受付DBに足す列は4つだけ**（段0結果／段0主張ID／正本主張ID／見送りの理由）。既存の列は変えない。**列が無い受付DBでも既存動線が壊れないこと**（`buildIntakeProperties` は無い列を積まない）
- **「残す」に一括操作を置かない**
- **検索窓とタブ構成は変えない。** 主張の段は窓の下、既存のページ結果の上に、あるときだけ開く
- **無料の利用者に主張の本文を返さない。** 題名・節名・件数と「棚に無い」の1行まで。オーナー専用の今も、返すデータを組み立てる段階で必ず通す
- **「棚に無い」の1行は必ず `MediNodeにはこの問いの検証済みの主張はまだありません`**（一字一句この文言）
- **AI で文章を作らない。** 段0が返すのは検証済みの主張・節・板の疑問だけ
- **メール文面に Recall の名前を出さない**
- テストは実データを通す。自作の文字列同士で比べない
- push は毎回オーナーの承認を取る。worktree を切って作業する

## File Structure

| ファイル | 責任 |
|---|---|
| `src/lib/ask-shelf/coverage.ts` | 覆い率の純関数と閾値の定数。**照合の正はここ1か所** |
| `src/lib/ask-shelf/rank.ts` | 3層の組み立て・重複落とし・無料有料の絞り込み（純関数） |
| `src/lib/ask-shelf/guard.ts` | `ask_shelf` のガード（`recall/guard.ts` と同型） |
| `src/lib/ask-shelf/landing.ts` | 回答通知の飛び先を決める純関数 |
| `src/lib/ask-shelf/intake-columns.ts` | 受付DBの新4列の読み書き（純関数）と「見送りの理由」の選択肢 |
| `src/app/api/ask-shelf/search/route.ts` | 段0の API |
| `src/app/api/ask-shelf/log/route.ts` | 段0の記録（依頼に進んだかの追記） |
| `src/components/AskShelfPanel.tsx` | 検索タブの主張の段 |
| `src/app/cq/answered/[id]/page.tsx` | 回答の着地画面 |
| `src/app/admin/AskShelfPanel.tsx` | /admin の「聞ける棚」パネル |
| `supabase/migrations/0030_ask_shelf.sql` | 列と表。拡張に依存しない |
| `supabase/migrations/0031_ask_shelf_pgroonga.sql` | PGroonga の拡張・`search_text` 生成列・索引（任意適用） |

既存で手を入れるもの: `src/lib/feature-access.ts`／`src/lib/recall/extract-claims.ts`／`src/lib/recall/sync-claims.ts`／`src/app/api/subscription/sync/_core.ts`／`src/lib/cq-dispatch.ts`／`src/lib/cq-submit.ts`／`src/lib/cq-answer-notify.ts`／`src/lib/account-profile.ts`／`src/app/page.tsx`／`src/components/CqCapture.tsx`

---

## Task 1: 覆い率の純関数

**Files:**
- Create: `src/lib/ask-shelf/coverage.ts`
- Test: `src/lib/__tests__/ask-shelf-coverage.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `normalizeForMatch(text: string): string` / `bigrams(text: string): string[]` / `type CoverageIndex = { idf: Map<string, number>; unknownWeight: number }` / `buildCoverageIndex(docs: string[]): CoverageIndex` / `coverage(query: string, docText: string, index: CoverageIndex): number` / 定数 `CLAIM_COVERAGE_MIN = 0.25`・`BOARD_COVERAGE_MIN = 0.15`・`CLAIM_RESULT_MAX = 5`・`SECTION_RESULT_MAX = 3`・`BOARD_RESULT_MAX = 2`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-coverage.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeForMatch, bigrams, buildCoverageIndex, coverage, CLAIM_COVERAGE_MIN } from '@/lib/ask-shelf/coverage'

describe('normalizeForMatch', () => {
  it('全角と半角・大小文字・記号の違いを消す', () => {
    expect(normalizeForMatch('ＭＡＰ６５ mmHg（未満）')).toBe(normalizeForMatch('map65mmhg未満'))
  })
  it('null 相当でも落ちない', () => {
    expect(normalizeForMatch('')).toBe('')
  })
})

describe('bigrams', () => {
  it('2文字ずつ1文字ずらして切り出す', () => {
    expect(bigrams('ショック')).toEqual(['ショ', 'ョッ', 'ック'])
  })
  it('1文字以下では空になる', () => {
    expect(bigrams('あ')).toEqual([])
  })
})

describe('coverage', () => {
  const docs = ['低血圧はショックの定義の要件ではない', '乳酸値は組織低灌流の指標である', '尿量は0.5 mL/kg/時未満で乏尿とする']
  const index = buildCoverageIndex(docs)

  it('文がそのまま含まれていれば1に近い', () => {
    expect(coverage('低血圧はショックの定義の要件ではない', docs[0], index)).toBeCloseTo(1, 5)
  })
  it('まったく重ならなければ0になる', () => {
    expect(coverage('白内障手術後の眼圧', docs[0], index)).toBe(0)
  })
  it('問いが空なら0を返す（0除算にしない）', () => {
    expect(coverage('', docs[0], index)).toBe(0)
  })
  it('コーパスに無い語は最大の重みで数え、覆えないぶん割合を下げる', () => {
    const withUnknown = coverage('ショック 眼圧', docs[0], index)
    const withoutUnknown = coverage('ショック', docs[0], index)
    expect(withUnknown).toBeLessThan(withoutUnknown)
  })
  it('閾値は0.25で1か所に置かれている', () => {
    expect(CLAIM_COVERAGE_MIN).toBe(0.25)
  })
})
```

- [ ] **Step 2: テストを走らせて落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-coverage.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/ask-shelf/coverage"`）

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/coverage.ts
// 段0の照合の正。文字2つずつ（bigram）に割り、珍しい語ほど重く数えて
// 「問いの言葉を、その主張がどれだけ覆えているか」を出す。
//
// 点数（BM25）ではなく覆い率を使う理由（2026-09-05 の実測・設計書参照）:
// 点数は問いの長さと語の一般性で膨らむため、棚に無い問いが棚にある問いより
// 高得点になる。実測では棚に無い問いの最高点が棚にある問いの最低点を上回り、
// 「無い」と言う閾値を引けなかった。覆い率は問いの側で正規化されるので引ける。
//
// PGroonga はこの計算の代わりではなく、候補を速く絞るためだけに使う。
// 順位と足切りは常にこの関数が決める（設計時の実測がそのまま本番の振る舞いになる）。

// 表記の揺れを消す。NFKC で全角半角をそろえ、記号と空白を落とす。
export function normalizeForMatch(text: string): string {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s、。，．・（）()「」『』:：;；/／\-–—[\]？?]+/g, '')
}

export function bigrams(text: string): string[] {
  const s = normalizeForMatch(text)
  const out: string[] = []
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2))
  return out
}

export type CoverageIndex = {
  idf: Map<string, number>
  // コーパスに1度も出ない語の重み。未知の語ほど「その主張には無い」と強く言えるので、
  // 最大の重みで数える（未知語だらけの問いは覆い率が下がり、正しく「無い」になる）。
  unknownWeight: number
}

export function buildCoverageIndex(docs: string[]): CoverageIndex {
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const g of new Set(bigrams(d))) df.set(g, (df.get(g) ?? 0) + 1)
  }
  const n = Math.max(docs.length, 1)
  const idf = new Map<string, number>()
  for (const [g, c] of df) idf.set(g, Math.log((n - c + 0.5) / (c + 0.5) + 1))
  return { idf, unknownWeight: Math.log(n + 1) }
}

// 0〜1。問いの語の重みの合計のうち、その主張が持っている語の重みの割合。
export function coverage(query: string, docText: string, index: CoverageIndex): number {
  const qs = new Set(bigrams(query))
  if (qs.size === 0) return 0
  const has = new Set(bigrams(docText))
  let total = 0
  let hit = 0
  for (const g of qs) {
    const w = index.idf.get(g) ?? index.unknownWeight
    total += w
    if (has.has(g)) hit += w
  }
  return total === 0 ? 0 : hit / total
}

// 足切りと件数。実測の出所は設計書 2026-09-05-ask-shelf-design.md。
// 0.25 は「棚にある25/27を拾い、棚に無い11/11を断る」点。ここ1か所で持つ。
export const CLAIM_COVERAGE_MIN = 0.25
// 板の近い疑問は母数が5件しかなく、誤って出しても「近い疑問」として読まれるため層1より緩い。
// この値は実測していない出発点（設計書に明記）。記録を見て引き直す。
export const BOARD_COVERAGE_MIN = 0.15
export const CLAIM_RESULT_MAX = 5
export const SECTION_RESULT_MAX = 3
export const BOARD_RESULT_MAX = 2
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-coverage.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/ask-shelf/coverage.ts src/lib/__tests__/ask-shelf-coverage.test.ts
git commit -m "feat(ask-shelf): 段0の照合の正となる覆い率の純関数を足す"
```

---

## Task 2: 実データの回帰（本番の主張と実在する問いで閾値を固定する）

**Files:**
- Create: `scripts/ask-shelf-fixture.mjs`
- Create: `src/lib/__tests__/ask-shelf-coverage-corpus.test.ts`
- Test: 同上

**Interfaces:**
- Consumes: Task 1 の `buildCoverageIndex`・`coverage`・`CLAIM_COVERAGE_MIN`
- Produces: `.preview/ask-shelf-fixture.json`（`{ capturedAt: string, claims: {claimId,pageId,pageTitle,sectionHeading,body,keywords}[], inShelf: {pageId,question}[], outOfShelf: string[] }`）

**なぜ `.preview/` か:** 主張の本文は有料のサブスク本文である。このリポジトリは公開なので、コミットしてはいけない。`.preview/` は `.gitignore` 済み（42行目）。よってテストは**固定資産が無ければスキップする**（他の端末と CI で落ちない）。

- [ ] **Step 1: 固定資産を作るスクリプトを書く**

```js
// scripts/ask-shelf-fixture.mjs
// 段0の回帰に使う固定資産を、本番の recall_claims と公開中の板から作る。
// 出力先は .preview/（.gitignore 済み）。有料の主張本文を公開リポにコミットしないため。
// 使い方: node scripts/ask-shelf-fixture.mjs
import fs from 'node:fs'
import path from 'node:path'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const h = { apikey: K, Authorization: `Bearer ${K}` }

const claims = await (await fetch(
  `${U}/rest/v1/recall_claims?select=claim_id,page_id,page_title,section_heading,body&active=eq.true&limit=5000`, { headers: h },
)).json()

// ページのキーワード欄は同期の入力にしかないので、手元のコーパスの写しから読む。
const corpusPath = '.preview/recall-corpus.json'
const kw = new Map()
if (fs.existsSync(corpusPath)) {
  for (const p of JSON.parse(fs.readFileSync(corpusPath, 'utf8'))) {
    kw.set(p.id.replace(/-/g, ''), p.props?.['キーワード'] ?? '')
  }
}

const board = (await (await fetch('https://medical-search-public.vercel.app/api/cq/board')).json()).items ?? []

// 棚にある側の問い: ページの題名（＝臨床の疑問文）。正解はそのページ由来の主張。
const byPage = new Map()
for (const c of claims) byPage.set(c.page_id.replace(/-/g, ''), c.page_title)

const out = {
  capturedAt: new Date().toISOString().slice(0, 10),
  note: '有料のサブスク本文を含む。公開リポにコミットしない（.preview/ は .gitignore 済み）',
  claims: claims.map((c) => ({
    claimId: c.claim_id,
    pageId: c.page_id.replace(/-/g, ''),
    pageTitle: c.page_title,
    sectionHeading: c.section_heading ?? '',
    body: c.body,
    keywords: kw.get(c.page_id.replace(/-/g, '')) ?? '',
  })),
  inShelf: [...byPage].map(([pageId, title]) => ({ pageId, question: title.replace(/^[💡📚]\s*/u, '') })),
  // 棚に無い側: 公開中の板の5件（運用で入れ替わる。capturedAt 時点の写し）＋コーパスに無い6分野。
  outOfShelf: [
    ...board.map((b) => b.title),
    '小児の熱性けいれんで頭部CTはいつ撮る？',
    '妊婦の甲状腺機能低下症に対するレボチロキシンの目標TSHは？',
    '地域包括ケア病棟の入院料の算定要件は？',
    '白内障手術後の眼圧上昇はいつまで見る？',
    '膝の変形性関節症にヒアルロン酸注射は効く？',
    '統合失調症の初回エピソードで抗精神病薬はいつまで続ける？',
  ],
}
fs.mkdirSync('.preview', { recursive: true })
fs.writeFileSync(path.join('.preview', 'ask-shelf-fixture.json'), JSON.stringify(out, null, 2))
console.log(`claims=${out.claims.length} inShelf=${out.inShelf.length} outOfShelf=${out.outOfShelf.length}`)
```

- [ ] **Step 2: 固定資産を作る**

Run: `node scripts/ask-shelf-fixture.mjs`
Expected: `claims=687 inShelf=27 outOfShelf=11`（件数は本番の主張が増えれば変わる。増えていたら次のステップの下限だけ据え置き、上限は書かない）

- [ ] **Step 3: 失敗する回帰テストを書く**

```ts
// src/lib/__tests__/ask-shelf-coverage-corpus.test.ts
// 実データの回帰。段0の閾値 0.25 が「棚にあるものを拾い、棚に無いものを断る」ことを固定する。
// 固定資産は .preview/ask-shelf-fixture.json（有料本文を含むため公開リポにコミットしない）。
// 無い端末ではスキップする。作り直しは `node scripts/ask-shelf-fixture.mjs`。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { buildCoverageIndex, coverage, CLAIM_COVERAGE_MIN } from '@/lib/ask-shelf/coverage'

const PATH = '.preview/ask-shelf-fixture.json'
const has = fs.existsSync(PATH)
const d = has ? JSON.parse(fs.readFileSync(PATH, 'utf8')) : null

describe.skipIf(!has)('段0の覆い率（本番の主張の写しで回帰）', () => {
  const docText = (c: { body: string; sectionHeading: string; keywords: string }) =>
    `${c.body} ${c.sectionHeading} ${c.keywords}`
  const index = buildCoverageIndex(d.claims.map(docText))
  const bestFor = (q: string) => Math.max(...d.claims.map((c: never) => coverage(q, docText(c), index)))

  it('棚に無い問いは、1件も閾値を超えない', () => {
    const over = d.outOfShelf.filter((q: string) => bestFor(q) >= CLAIM_COVERAGE_MIN)
    expect(over).toEqual([])
  })

  it('棚にある問いは、9割以上が閾値を超える', () => {
    const hit = d.inShelf.filter((q: { question: string }) => bestFor(q.question) >= CLAIM_COVERAGE_MIN)
    expect(hit.length / d.inShelf.length).toBeGreaterThanOrEqual(0.9)
  })

  it('棚にある問いの9割以上で、1位が正解ページの主張になる', () => {
    let top1 = 0
    for (const q of d.inShelf) {
      let best = -1
      let bestPage = ''
      for (const c of d.claims) {
        const s = coverage(q.question, docText(c), index)
        if (s > best) { best = s; bestPage = c.pageId }
      }
      if (bestPage === q.pageId) top1++
    }
    expect(top1 / d.inShelf.length).toBeGreaterThanOrEqual(0.9)
  })
})
```

- [ ] **Step 4: 走らせて通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-coverage-corpus.test.ts`
Expected: PASS（3件）。落ちたら閾値ではなく**実装を疑う**。実測では棚に無い11件が全て 0.19 以下、棚にある27件のうち25件が 0.25 以上だった。

- [ ] **Step 5: コミット**

```bash
git add scripts/ask-shelf-fixture.mjs src/lib/__tests__/ask-shelf-coverage-corpus.test.ts
git commit -m "test(ask-shelf): 本番の主張の写しで覆い率の閾値を固定する回帰を足す

固定資産は .preview/（gitignore 済み）に置き、有料の本文は公開リポに入れない。
資産が無い端末ではスキップする。"
```

---

## Task 3: migration 0030 / 0031 と適用台帳の更新

**Files:**
- Create: `supabase/migrations/0030_ask_shelf.sql`
- Create: `supabase/migrations/0031_ask_shelf_pgroonga.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**
- Consumes: なし
- Produces: `recall_claims.keywords`(text) / `recall_claims.search_text`(生成列 text) / `ask_shelf_queries` 表 / `user_settings.experience_years`(text) / `user_settings.doctor_departments`(text[])

- [ ] **Step 1: 0030 を書く（拡張に依存しない部分だけ）**

```sql
-- supabase/migrations/0030_ask_shelf.sql
-- 聞ける棚（段0＋段2）。設計: docs/superpowers/specs/2026-09-05-ask-shelf-design.md
--
-- PGroonga の索引はこのファイルに入れない。拡張が入っていない環境では
-- `create index using pgroonga` 自体が失敗し、このファイル全体が流れなくなるため。
-- 索引は 0031（任意適用）に分ける。0030 だけ流せば段0は動く（全件読みにフォールバックする）。

-- 段0の照合に使う文字列。ページのキーワード欄まで含めると、実測で
-- 「正解が1位」が 81% から 96% に上がった（設計書の実測の節）。
alter table public.recall_claims
  add column if not exists keywords text not null default '';

-- 段0を出した回の記録。完了条件「段0を見せた後に送らずに済んだ割合」をここから出す。
-- 問いの本文は利用者が書いた臨床の疑問なので、/admin 以外には出さない
-- （cq_submissions と同じ扱い）。RLS 有効・ポリシー無し＝service_role のみ。
create table if not exists public.ask_shelf_queries (
  id            bigserial primary key,
  user_id       uuid not null,
  query         text not null,
  claim_count   int  not null default 0,
  section_count int  not null default 0,
  board_count   int  not null default 0,
  top_coverage  real not null default 0,
  submitted     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists ask_shelf_queries_created_idx on public.ask_shelf_queries (created_at);
alter table public.ask_shelf_queries enable row level security;

-- 経験年数・診療科をアカウントに持たせる（裁定7）。職種は 0024 で入っている。
-- 列が無くても account-profile.ts は落ちない作りなので、流す前でも壊れない。
alter table public.user_settings
  add column if not exists experience_years text;
alter table public.user_settings
  add column if not exists doctor_departments text[];
```

- [ ] **Step 2: 0031 を書く（任意適用）**

```sql
-- supabase/migrations/0031_ask_shelf_pgroonga.sql
-- 任意適用。段0の候補絞り込みを速くするためだけの索引で、無くても動く
-- （src/lib/ask-shelf/rank.ts が全件読みにフォールバックする）。
-- Supabase のダッシュボードの Extensions で pgroonga を有効にしてから流す。
-- 有効でないまま流すと、この1文だけが失敗する（0030 には影響しない）。
-- 照合に使う文字列。段0の順位と足切りは TypeScript の覆い率が決めるので、
-- この列と索引は候補を速く絞るためだけにある。0030 に置くと「誰も読まない列」が
-- 残るので、索引と同じファイルにまとめる。
create extension if not exists pgroonga;
alter table public.recall_claims
  drop column if exists search_text;
alter table public.recall_claims
  add column search_text text
  generated always as (body || ' ' || section_heading || ' ' || keywords) stored;
create index if not exists recall_claims_search_text_pgroonga
  on public.recall_claims using pgroonga (search_text);
```

- [ ] **Step 3: 適用台帳を直す**

`supabase/migrations/README.md` の表で、次の2点を直す。

1. 0024 の行の本番欄を `❓ 未確認 ※3` から `✅ ※7` に変える
2. 表の末尾に 0030・0031 の行を足し、注記 ※7 を足す

```markdown
| 0030 | ask_shelf | `recall_claims.keywords`, `ask_shelf_queries`, `user_settings.experience_years`/`doctor_departments` | ⬜ 未適用 |
| 0031 | ask_shelf_pgroonga（任意） | `recall_claims.search_text` と PGroonga 索引 | ⬜ 未適用 ※8 |
```

```markdown
※7 2026-09-05 に本番DBで実測。`/rest/v1/user_settings?select=occupation&limit=1` が 200 を返し、
`occupation` 列が存在することを確認した。以前の「未確認」は記録漏れ。
※8 0031 は無くても段0は動く（候補絞り込みが全件読みになるだけ）。
Supabase の Extensions で pgroonga を有効にしてから流す。
```

- [ ] **Step 4: SQL の構文を確かめる**

Run: `npx tsc --noEmit`（SQL はビルド対象外なので、ここでは型が壊れていないことだけ見る）
そのうえで **0030 を本番の SQL Editor に流すのはオーナーの作業**。この計画では流さない。

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/0030_ask_shelf.sql supabase/migrations/0031_ask_shelf_pgroonga.sql supabase/migrations/README.md
git commit -m "feat(ask-shelf): migration 0030/0031 と適用台帳の更新

0031（PGroonga索引）を分けたのは、拡張が無い環境で create index が失敗すると
0030 ごと流れなくなるため。0030 だけで段0は動く。
あわせて 0024 を本番実測の結果で ✅ に直す。"
```

---

## Task 4: 同期でページのキーワードを主張に写す

**Files:**
- Modify: `src/lib/recall/extract-claims.ts`（`ClaimSource` に `keywords` を足す）
- Modify: `src/lib/recall/types.ts`（`RecallClaim` に `keywords` を足す）
- Modify: `src/lib/recall/sync-claims.ts`（upsert する行に `keywords` を足す）
- Modify: `src/app/api/subscription/sync/_core.ts:247`（`extractClaims` の呼び出しに1行足す）
- Modify: `src/lib/recall/guard.ts`（`claimFromRow` に `keywords` を足す）
- Test: `src/lib/__tests__/recall-extract-claims.test.ts`（既存に追記）

**Interfaces:**
- Consumes: なし
- Produces: `RecallClaim.keywords: string`（既定 `''`）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-extract-claims.test.ts の末尾に追記
it('ページのキーワード欄を主張に写す（段0の照合で使う）', () => {
  const claims = extractClaims({
    pageId: 'page-1',
    pageTitle: '💡 テストの問い',
    pageKind: '💡',
    genres: ['05.循環'],
    keywords: 'ショック, shock, 組織低灌流',
    blocks: FIXTURE_BLOCKS, // このファイルで既に使っている見出し＋主張行のブロック列
  })
  expect(claims.length).toBeGreaterThan(0)
  expect(claims[0].keywords).toBe('ショック, shock, 組織低灌流')
})

it('キーワードを渡さなくても空文字で通る（既存の呼び出しを壊さない）', () => {
  const claims = extractClaims({
    pageId: 'page-1', pageTitle: '💡 テストの問い', pageKind: '💡', genres: [], blocks: FIXTURE_BLOCKS,
  })
  expect(claims[0].keywords).toBe('')
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-extract-claims.test.ts`
Expected: FAIL（`keywords` が型に無い／`undefined`）

- [ ] **Step 3: 5つのファイルに足す**

```ts
// src/lib/recall/extract-claims.ts:17 を差し替え
// keywords はページの「キーワード」欄（同義語・英語表記が並ぶ）。段0の照合に効くので主張へ写す。
// 省略可にしてあるのは、既存の呼び出し（テストを含む）を一斉に書き換えないため。
export type ClaimSource = { pageId: string; pageTitle: string; pageKind: string; genres: string[]; keywords?: string; blocks: NotionBlockLite[] }
```

`extractClaims` の中で `RecallClaim` を組み立てている箇所に `keywords: src.keywords ?? ''` を足す。

```ts
// src/lib/recall/types.ts の RecallClaim に足す
  /** ページの「キーワード」欄。段0の照合にだけ使う（画面には出さない） */
  keywords: string
```

```ts
// src/lib/recall/sync-claims.ts:106 付近の row に足す
        claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
        keywords: c.keywords ?? '',
```

```ts
// src/app/api/subscription/sync/_core.ts:247 の extractClaims 呼び出しに足す
          claims.push(...extractClaims({
            pageId: page.id,
            pageTitle: title,
            pageKind: Array.from(title.trim())[0] ?? '',
            genres: extractList(props['ジャンル'] || {}),
            // 段0の照合に使う。record.aiKeywords と同じ値（同じ props から取る）。
            keywords: extractText(props['キーワード'] || {}),
            blocks,
          }))
```

```ts
// src/lib/recall/guard.ts の claimFromRow に足す
    keywords: String(r.keywords ?? ''),
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-extract-claims.test.ts src/lib/__tests__/recall-sync-claims.test.ts src/lib/__tests__/subscription-sync-core.test.ts && npx tsc --noEmit`
Expected: すべて PASS、型エラー0

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/ src/app/api/subscription/sync/_core.ts
git commit -m "feat(ask-shelf): 同期でページのキーワードを主張に写す

段0の照合でキーワード欄まで見ると、正解が1位になる割合が実測で 81% から 96% に上がる。"
```

---

## Task 5: `ask_shelf` の機能フラグとガード

**Files:**
- Modify: `src/lib/feature-access.ts`
- Create: `src/lib/ask-shelf/guard.ts`
- Create: `src/lib/ask-shelf-flag.ts`
- Test: `src/lib/__tests__/feature-access.test.ts`（既存に追記）

**Interfaces:**
- Consumes: `hasFeature`・`sessionHasFeature`（既存）
- Produces: `requireAskShelf(): Promise<{ok:true; supabase; admin: () => …; userId: string; email: string|null} | {ok:false; response: NextResponse}>` / `notFound()` と HEAD・OPTIONS・PUT・PATCH・DELETE の再輸出 / `serverError(where, error)` / `isAskShelfEnabled(): boolean`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/feature-access.test.ts の末尾に追記
describe('ask_shelf', () => {
  it('ASK_SHELF_EMAILS に載っていれば開く', () => {
    process.env.ASK_SHELF_EMAILS = 'owner@example.com'
    expect(hasFeature('ask_shelf', { email: 'owner@example.com' })).toBe(true)
  })
  it('EARLY_ACCESS_EMAILS には落ちない（フォールバック無し）', () => {
    process.env.ASK_SHELF_EMAILS = ''
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    expect(hasFeature('ask_shelf', { email: 'monitor@example.com' })).toBe(false)
  })
  it('レガシーの early_access(boolean) では開かない', () => {
    expect(hasFeature('ask_shelf', { email: 'x@example.com', ledgerEarlyAccess: true })).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/feature-access.test.ts`
Expected: FAIL（`ask_shelf` が `EarlyAccessFeature` に無い型エラー）

- [ ] **Step 3: 実装する**

```ts
// src/lib/feature-access.ts の一覧を差し替え
export const EARLY_ACCESS_FEATURES = ['easy_connect', 'multi_department', 'tower', 'personal_reader', 'recall', 'ask_shelf'] as const
```

```ts
// 同ファイルの FEATURE_ENV に足す
  // 聞ける棚（外の輪の階段）。Recall と同じく drnode.com の公開判断までオーナー専用。
  // 専用リストのみ・フォールバック無し（EARLY_ACCESS_EMAILS に落とすと、他機能の
  // モニターに未完成の依頼経路まで開いてしまう）。ASK_SHELF_GA は公開判断まで置かない。
  ask_shelf: { ga: 'ASK_SHELF_GA', emails: 'ASK_SHELF_EMAILS' },
```

```ts
// src/lib/ask-shelf/guard.ts
// 聞ける棚のルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
// recall/guard.ts と同型（拒否に本文を持たせない・未実装メソッドも同じ 404 で塞ぐ）。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'

export function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

// Next が自動で埋める OPTIONS(204)・他(405) は requireAskShelf を通らないため、
// 存在しない経路との違いが1リクエストで分かってしまう。同じ 404 で塞ぐ。
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function requireAskShelf(): Promise<
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      admin: () => ReturnType<typeof createAdminClient>
      userId: string
      email: string | null
    }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('ask_shelf'))) return { ok: false, response: notFound() }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, admin: () => createAdminClient(), userId: user.id, email: user.email ?? null }
}

export function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[ask-shelf] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}
```

```ts
// src/lib/ask-shelf-flag.ts
// 表示制御のみ。判定の正はサーバー（requireAskShelf）。recall-flag.ts と同型。
import { getSettings } from './settings'

export function isAskShelfEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('ask_shelf')
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/feature-access.test.ts && npx tsc --noEmit`
Expected: PASS、型エラー0

- [ ] **Step 5: コミット**

```bash
git add src/lib/feature-access.ts src/lib/ask-shelf/guard.ts src/lib/ask-shelf-flag.ts src/lib/__tests__/feature-access.test.ts
git commit -m "feat(ask-shelf): 機能フラグ ask_shelf とルートのガードを足す"
```

---

## Task 6: 3層の組み立て（純関数）

**Files:**
- Create: `src/lib/ask-shelf/rank.ts`
- Test: `src/lib/__tests__/ask-shelf-rank.test.ts`

**Interfaces:**
- Consumes: Task 1 の `buildCoverageIndex`・`coverage`・各定数
- Produces:
  - `type ShelfClaim = { claimId: string; pageId: string; pageTitle: string; sectionKey: string; sectionHeading: string; body: string; source: string; confidence: string; keywords: string }`
  - `type ShelfSection = { objectID: string; pageId: string; pageTitle: string; sectionHeading: string }`
  - `type ShelfBoardItem = { id: string; title: string; voteCount: number }`
  - `type RankedClaim = { claim: ShelfClaim; coverage: number; kept: boolean; bodyVisible: boolean }`
  - `type ShelfResult = { claims: RankedClaim[]; sections: ShelfSection[]; board: ShelfBoardItem[]; topCoverage: number; emptyMessage: string | null }`
  - `rankAskShelf(input: RankInput): ShelfResult`
  - `SHELF_EMPTY_MESSAGE`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-rank.test.ts
import { describe, it, expect } from 'vitest'
import { rankAskShelf, SHELF_EMPTY_MESSAGE } from '@/lib/ask-shelf/rank'
import type { ShelfClaim, ShelfSection, ShelfBoardItem } from '@/lib/ask-shelf/rank'

const claim = (over: Partial<ShelfClaim>): ShelfClaim => ({
  claimId: 'c1', pageId: 'p1', pageTitle: '💡 ショックの問い', sectionKey: 'sec1',
  sectionHeading: '1. 低血圧は要件ではない', body: '低血圧はショックの定義の要件ではない',
  source: 'ESICM 2014', confidence: 'ok', keywords: 'ショック, 組織低灌流', ...over,
})
const section = (over: Partial<ShelfSection>): ShelfSection => ({
  objectID: 'subscription_p1#sec1', pageId: 'p1', pageTitle: '💡 ショックの問い',
  sectionHeading: '1. 低血圧は要件ではない', ...over,
})
const board = (over: Partial<ShelfBoardItem>): ShelfBoardItem => ({
  id: 'b1', title: '尿道カテーテルはいつ抜くべき？', voteCount: 0, ...over,
})

const base = {
  claims: [claim({}), claim({ claimId: 'c2', body: '乳酸値は組織低灌流の指標である', sectionKey: 'sec2', sectionHeading: '2. 乳酸値' })],
  sections: [section({})],
  boardItems: [board({})],
  keptClaimIds: new Set<string>(),
  paid: true,
}

describe('rankAskShelf', () => {
  it('覆い率が閾値以上の主張だけを返す', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない' })
    expect(r.claims.map((c) => c.claim.claimId)).toContain('c1')
    expect(r.emptyMessage).toBeNull()
  })

  it('棚に無い問いは主張を返さず、決まった1行を返す', () => {
    const r = rankAskShelf({ ...base, query: '白内障手術後の眼圧上昇はいつまで見る？' })
    expect(r.claims).toEqual([])
    expect(r.emptyMessage).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
    expect(SHELF_EMPTY_MESSAGE).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
  })

  it('自分が残した主張は覆い率が低くても最上位に出て、印が付く', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない', keptClaimIds: new Set(['c2']) })
    expect(r.claims[0].claim.claimId).toBe('c2')
    expect(r.claims[0].kept).toBe(true)
  })

  it('無料の利用者には本文を出さない（題名・節名までにする）', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない', paid: false })
    expect(r.claims.length).toBeGreaterThan(0)
    expect(r.claims[0].bodyVisible).toBe(false)
    expect(r.claims[0].claim.body).toBe('')
    expect(r.claims[0].claim.source).toBe('')
    expect(r.claims[0].claim.pageTitle).not.toBe('')
  })

  it('層1で出した節は層2から落とす（同じ場所を二度出さない）', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない' })
    expect(r.sections.find((s) => s.pageId === 'p1' && s.sectionHeading === '1. 低血圧は要件ではない')).toBeUndefined()
  })

  it('板の近い疑問は緩い閾値で最大2件', () => {
    const r = rankAskShelf({ ...base, query: '尿道カテーテルはいつ抜くべき？' })
    expect(r.board.map((b) => b.id)).toEqual(['b1'])
  })

  it('問いが空なら何も返さず、1行も出さない', () => {
    const r = rankAskShelf({ ...base, query: '   ' })
    expect(r.claims).toEqual([])
    expect(r.sections).toEqual([])
    expect(r.board).toEqual([])
    expect(r.emptyMessage).toBeNull()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-rank.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/ask-shelf/rank"`）

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/rank.ts
// 段0の3層の組み立て。AI を使わず、返すのは検証済みの主張・既存の節・板に出ている疑問だけ。
// 層1 主張（recall_claims）→ 層2 節・記事（既存の検索索引）→ 層3 板の近い疑問。
// 各層は独立して空になりうる。3層とも空のときは依頼だけが残る。
import {
  buildCoverageIndex, coverage,
  CLAIM_COVERAGE_MIN, BOARD_COVERAGE_MIN, CLAIM_RESULT_MAX, SECTION_RESULT_MAX, BOARD_RESULT_MAX,
} from './coverage'

export type ShelfClaim = {
  claimId: string; pageId: string; pageTitle: string; sectionKey: string
  sectionHeading: string; body: string; source: string; confidence: string; keywords: string
}
export type ShelfSection = { objectID: string; pageId: string; pageTitle: string; sectionHeading: string }
export type ShelfBoardItem = { id: string; title: string; voteCount: number }

export type RankedClaim = {
  claim: ShelfClaim
  coverage: number
  /** 利用者自身が残している主張か（継ぎ目7b。最上位に出して印を付ける） */
  kept: boolean
  /** 本文を出してよいか。無料の利用者には false（題名・節名・件数までにする） */
  bodyVisible: boolean
}
export type ShelfResult = {
  claims: RankedClaim[]
  sections: ShelfSection[]
  board: ShelfBoardItem[]
  topCoverage: number
  /** 層1が空のときだけ入る決まった1行。空でないときは null */
  emptyMessage: string | null
}

// 一字一句この文言。「棚に無い」と言い切りつつ、医学的な根拠が無いとは誤解させない。
export const SHELF_EMPTY_MESSAGE = 'MediNodeにはこの問いの検証済みの主張はまだありません'

export type RankInput = {
  query: string
  claims: ShelfClaim[]
  sections: ShelfSection[]
  boardItems: ShelfBoardItem[]
  /** recall_progress に有効な行がある主張の鍵 */
  keptClaimIds: Set<string>
  /** 主張の本文を出してよい利用者か（プレミアム） */
  paid: boolean
}

function claimText(c: ShelfClaim): string {
  return `${c.body} ${c.sectionHeading} ${c.keywords}`
}

// 無料の利用者に返す形。本文・出典・確信度を落とし、題名と節名だけ残す。
// UI で隠すのではなく、ここで値を落とす（画面の実装を1つ忘れただけで本文が漏れるのを防ぐ）。
function redact(c: ShelfClaim): ShelfClaim {
  return { ...c, body: '', source: '', confidence: '', keywords: '' }
}

export function rankAskShelf(input: RankInput): ShelfResult {
  const q = input.query.trim()
  if (!q) return { claims: [], sections: [], board: [], topCoverage: 0, emptyMessage: null }

  // 重みはコーパス全体（絞り込み前の主張）から作る。候補だけで作ると、
  // 候補に多い語が「珍しくない」と誤って軽く扱われる。
  const index = buildCoverageIndex(input.claims.map(claimText))

  const scored = input.claims
    .map((c) => ({ claim: c, coverage: coverage(q, claimText(c), index), kept: input.keptClaimIds.has(c.claimId) }))
    // 残した主張は閾値を通さない（本人が既に手元に置いたものなので、出さない理由がない）。
    .filter((x) => x.kept || x.coverage >= CLAIM_COVERAGE_MIN)
    // 残した主張が最上位（継ぎ目7b）。その中と、その下は覆い率の降順。
    .sort((a, b) => (a.kept === b.kept ? b.coverage - a.coverage : a.kept ? -1 : 1))
    .slice(0, CLAIM_RESULT_MAX)

  const claims: RankedClaim[] = scored.map((x) => ({
    claim: input.paid ? x.claim : redact(x.claim),
    coverage: x.coverage,
    kept: x.kept,
    bodyVisible: input.paid,
  }))

  // 層1で出した節は層2から落とす。節の同一性はページIDと節名で見る
  // （層2の objectID は subscription_<pageId>#secN、層1は sectionKey なので直接は比べられない）。
  const shown = new Set(scored.map((x) => `${x.claim.pageId} ${x.claim.sectionHeading}`))
  const sections = input.sections
    .filter((s) => !shown.has(`${s.pageId} ${s.sectionHeading}`))
    .slice(0, SECTION_RESULT_MAX)

  const board = input.boardItems
    .map((b) => ({ item: b, c: coverage(q, b.title, index) }))
    .filter((x) => x.c >= BOARD_COVERAGE_MIN)
    .sort((a, b) => b.c - a.c)
    .slice(0, BOARD_RESULT_MAX)
    .map((x) => x.item)

  return {
    claims,
    sections,
    board,
    topCoverage: scored.length ? Math.max(...scored.map((x) => x.coverage)) : 0,
    emptyMessage: claims.length === 0 ? SHELF_EMPTY_MESSAGE : null,
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-rank.test.ts && npx tsc --noEmit`
Expected: PASS（7件）、型エラー0

- [ ] **Step 5: コミット**

```bash
git add src/lib/ask-shelf/rank.ts src/lib/__tests__/ask-shelf-rank.test.ts
git commit -m "feat(ask-shelf): 段0の3層の組み立てを純関数で足す

無料の利用者への絞り込みは UI ではなくこの関数で値を落とす。
画面の実装を1つ忘れただけで有料の本文が漏れる作りにしない。"
```

---

## Task 7: 段0の API

**Files:**
- Create: `src/app/api/ask-shelf/search/route.ts`
- Test: `src/lib/__tests__/ask-shelf-search-route.test.ts`

**Interfaces:**
- Consumes: Task 5 の `requireAskShelf`・`serverError`・`notFound`、Task 6 の `rankAskShelf`・`ShelfClaim`
- Produces: `POST /api/ask-shelf/search`。入力 `{ query: string }`、出力 `{ claims: RankedClaim[]; sections: ShelfSection[]; board: ShelfBoardItem[]; emptyMessage: string|null; topCoverage: number; logId: number|null }`

**PGroonga のフォールバック（設計上の要点）:** 索引がある環境でも、ここでは `recall_claims` の `active=true` を全件読み、覆い率で絞る。索引の有無で結果が変わらないことを優先する。索引が効くのは主張が数千を超えてからで、そのときに候補の絞り込みを足す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-search-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  feature: true,
  user: { id: 'u1', email: 'owner@example.com' } as { id: string; email: string } | null,
  claims: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
}

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from(table: string) {
      const rows = table === 'recall_claims' ? state.claims : state.progress
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: async () => ({ data: rows, error: null }),
        limit: async () => ({ data: rows, error: null }),
        insert: (v: Record<string, unknown>) => {
          state.inserted.push(v)
          return { select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }
        },
      }
      return q
    },
  }),
}))
// 層2・層3は別経路。ここでは段0の骨だけを見る。
vi.mock('@/lib/ask-shelf/sources', () => ({ fetchSections: async () => [], fetchBoardItems: async () => [] }))

const { POST } = await import('@/app/api/ask-shelf/search/route')
const call = (body: unknown) =>
  POST(new Request('http://x/api/ask-shelf/search', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.feature = true
  state.user = { id: 'u1', email: 'owner@example.com' }
  state.inserted = []
  state.progress = []
  state.claims = [{
    claim_id: 'c1', page_id: 'p1', page_title: '💡 ショックの問い', section_key: 'sec1',
    section_heading: '1. 低血圧は要件ではない', body: '低血圧はショックの定義の要件ではない',
    source: 'ESICM 2014', confidence: 'ok', keywords: 'ショック', active: true,
  }]
})

describe('POST /api/ask-shelf/search', () => {
  it('フラグが閉じていれば本文なしの404（機能の存在を見せない）', async () => {
    state.feature = false
    const res = await call({ query: 'ショック' })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('未ログインなら401', async () => {
    state.user = null
    expect((await call({ query: 'ショック' })).status).toBe(401)
  })

  it('棚にある問いは主張を返す', async () => {
    const json = await (await call({ query: '低血圧はショックの定義の要件ではない' })).json()
    expect(json.claims[0].claim.claimId).toBe('c1')
    expect(json.emptyMessage).toBeNull()
  })

  it('棚に無い問いは決まった1行を返す', async () => {
    const json = await (await call({ query: '白内障手術後の眼圧上昇' })).json()
    expect(json.claims).toEqual([])
    expect(json.emptyMessage).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
  })

  it('問いが長すぎるときは400（上限は投稿フォームと同じ1000字）', async () => {
    expect((await call({ query: 'あ'.repeat(1001) })).status).toBe(400)
  })

  it('段0を出した回を記録する（送らずに済んだ割合を測るため）', async () => {
    await call({ query: '低血圧はショックの定義の要件ではない' })
    expect(state.inserted.length).toBe(1)
    expect(state.inserted[0].submitted).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-search-route.test.ts`
Expected: FAIL（route と sources が無い）

- [ ] **Step 3: 層2・層3の取得を1ファイルに切り出す**

```ts
// src/lib/ask-shelf/sources.ts
// 段0の層2（節・記事）と層3（板の近い疑問）の取得。どちらも既存の経路をそのまま使い、
// 新しい索引・新しい保管場所を作らない。失敗しても空配列を返し、段0全体は止めない
// （層1が出ていれば段0は成立する）。
import type { ShelfSection, ShelfBoardItem } from './rank'

export async function fetchSections(query: string): Promise<ShelfSection[]> {
  try {
    // 既存のサブスク索引に節レコード（recordType:section）がある。
    // objectID は `subscription_<pageId>#secN`（src/lib/subscription-sections.ts）。
    const { searchSubscriptionIndex } = await import('@/lib/algolia')
    const hits = await searchSubscriptionIndex(query, { filters: 'recordType:section', hitsPerPage: 8 })
    return hits.map((h) => ({
      objectID: String(h.objectID),
      pageId: String(h.parentId ?? '').replace(/-/g, ''),
      pageTitle: String(h.title ?? ''),
      sectionHeading: String(h.sectionText ?? ''),
    }))
  } catch (err) {
    console.error('[ask-shelf] 節の取得に失敗（層2は空で続行）:', err)
    return []
  }
}

export async function fetchBoardItems(): Promise<ShelfBoardItem[]> {
  try {
    const { fetchBoardCqs } = await import('@/lib/cq-board')
    const items = await fetchBoardCqs()
    return items.map((i) => ({ id: i.id, title: i.title, voteCount: i.voteCount }))
  } catch (err) {
    console.error('[ask-shelf] 板の取得に失敗（層3は空で続行）:', err)
    return []
  }
}
```

`searchSubscriptionIndex` と `fetchBoardCqs` の実際の関数名は `src/lib/algolia.ts` と `src/lib/cq-board.ts` を開いて合わせること。名前が違えば**このファイル側を合わせる**（既存の公開APIを改名しない）。

- [ ] **Step 4: API を実装する**

```ts
// src/app/api/ask-shelf/search/route.ts
import { NextResponse } from 'next/server'
import { requireAskShelf, serverError, notFound } from '@/lib/ask-shelf/guard'
import { rankAskShelf, type ShelfClaim } from '@/lib/ask-shelf/rank'
import { fetchSections, fetchBoardItems } from '@/lib/ask-shelf/sources'
import { QUESTION_MAX } from '@/lib/cq-submit'

export const dynamic = 'force-dynamic'
export { HEAD, OPTIONS, PUT, PATCH, DELETE } from '@/lib/ask-shelf/guard'
// 問いは臨床の疑問で、患者背景が書かれうる。GET のクエリ文字列に載せない
// （アクセスログや履歴に残る）。POST だけを開ける。
export const GET = notFound

export async function POST(req: Request) {
  const g = await requireAskShelf()
  if (!g.ok) return g.response

  let query = ''
  try {
    const body = (await req.json()) as { query?: unknown }
    query = typeof body.query === 'string' ? body.query.trim() : ''
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // 上限は投稿フォームと同じ値を輸入する。二重に数字を持たない。
  if (query.length > QUESTION_MAX) return NextResponse.json({ error: 'too_long' }, { status: 400 })
  if (!query) {
    return NextResponse.json({ claims: [], sections: [], board: [], emptyMessage: null, topCoverage: 0, logId: null })
  }

  const admin = g.admin()

  // recall_claims は RLS 有効・ポリシー無し（service_role のみ・migration 0029）。
  // active の絞り込みはポリシーが無い今、この1行だけが担う（消すと取り下げた主張まで段0に出る）。
  // PGroonga 索引（0031・任意）が有る環境でも全件を読む。索引の有無で段0の結果が
  // 変わらないことを優先するため。主張が数千を超えたらここに候補の絞り込みを足す。
  const { data: claimRows, error: claimErr } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, section_key, section_heading, body, source, confidence, keywords')
    .eq('active', true)
    .limit(5000)
  if (claimErr) return serverError('claims の読み取りに失敗', claimErr)

  const { data: progRows } = await admin
    .from('recall_progress').select('claim_id').eq('user_id', g.userId).is('removed_at', null)

  const claims: ShelfClaim[] = (claimRows ?? []).map((r) => ({
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''),
    body: String(r.body ?? ''), source: String(r.source ?? ''), confidence: String(r.confidence ?? ''),
    keywords: String(r.keywords ?? ''),
  }))

  const [sections, boardItems] = await Promise.all([fetchSections(query), fetchBoardItems()])

  const result = rankAskShelf({
    query, claims, sections, boardItems,
    keptClaimIds: new Set((progRows ?? []).map((r) => String(r.claim_id))),
    // オーナー専用の今も必ず通す。公開時に足すのではなく、最初から通しておく（継ぎ目9）。
    paid: true,
  })

  // 完了条件「段0を見せた後に送らずに済んだ割合」のための記録。
  const { data: logRow } = await admin.from('ask_shelf_queries').insert({
    user_id: g.userId, query, claim_count: result.claims.length,
    section_count: result.sections.length, board_count: result.board.length,
    top_coverage: result.topCoverage, submitted: false,
  }).select().single()

  return NextResponse.json({ ...result, logId: logRow?.id ?? null })
}
```

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-search-route.test.ts && npx tsc --noEmit`
Expected: PASS（6件）、型エラー0

```bash
git add src/app/api/ask-shelf/search src/lib/ask-shelf/sources.ts src/lib/__tests__/ask-shelf-search-route.test.ts
git commit -m "feat(ask-shelf): 段0の API を足す（3層・記録つき）"
```

---

## Task 8: 検索タブの主張の段

**Files:**
- Create: `src/components/AskShelfPanel.tsx`
- Modify: `src/app/page.tsx`（検索結果の描画に段を差し込む。既存の `CqCaptureSuggestion` の近く・1162行付近）
- Create: `src/app/api/ask-shelf/log/route.ts`（依頼に進んだことの追記）
- Test: `src/lib/__tests__/ask-shelf-log-route.test.ts`

**Interfaces:**
- Consumes: Task 7 の `POST /api/ask-shelf/search`、`isAskShelfEnabled()`
- Produces: `POST /api/ask-shelf/log` … 入力 `{ logId: number }` / 出力 `{ ok: true }`。`ask_shelf_queries.submitted` を true にする

**画面の決まり（設計書の継ぎ目8）**

- 検索窓とタブ構成は変えない
- 主張があるときだけ、窓の下・既存のページ結果の上に段が開く。折りたためる
- 主張が無いときは決まった1行だけを出す
- 各主張に出すもの: 節名 → 主張の本文 → 出典 →「残す」「この節を読む」
- 自分が残した主張には「あなたが残した」の印を付け、最上位に置く
- 段の末尾に「MediNodeに足してほしい疑問を送る」（Task 13 の文言）
- `isAskShelfEnabled()` が偽なら**何も描かない**（既存のゼロ件表示のまま）

- [ ] **Step 1: 追記 API の失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-log-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { feature: true, user: { id: 'u1' } as { id: string } | null, updates: [] as Record<string, unknown>[], eqs: [] as unknown[][] }

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: (v: Record<string, unknown>) => { state.updates.push(v); return q },
        eq: (col: string, val: unknown) => { state.eqs.push([col, val]); return q },
        then: (r: (v: { error: null }) => void) => r({ error: null }),
      }
      return q
    },
  }),
}))

const { POST } = await import('@/app/api/ask-shelf/log/route')
const call = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { state.feature = true; state.user = { id: 'u1' }; state.updates = []; state.eqs = [] })

describe('POST /api/ask-shelf/log', () => {
  it('フラグが閉じていれば404', async () => {
    state.feature = false
    expect((await call({ logId: 1 })).status).toBe(404)
  })
  it('依頼に進んだことを記録する', async () => {
    expect((await call({ logId: 1 })).status).toBe(200)
    expect(state.updates[0]).toEqual({ submitted: true })
  })
  it('他人の記録は更新できない（user_id で必ず絞る）', async () => {
    await call({ logId: 1 })
    expect(state.eqs).toContainEqual(['user_id', 'u1'])
  })
  it('logId が数値でなければ400', async () => {
    expect((await call({ logId: 'x' })).status).toBe(400)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-log-route.test.ts`
Expected: FAIL（route が無い）

- [ ] **Step 3: 追記 API を実装する**

```ts
// src/app/api/ask-shelf/log/route.ts
import { NextResponse } from 'next/server'
import { requireAskShelf, serverError, notFound } from '@/lib/ask-shelf/guard'

export const dynamic = 'force-dynamic'
export { HEAD, OPTIONS, PUT, PATCH, DELETE } from '@/lib/ask-shelf/guard'
export const GET = notFound

// 段0を見たあと依頼に進んだことを記録する。完了条件の「送らずに済んだ割合」の分母と分子。
export async function POST(req: Request) {
  const g = await requireAskShelf()
  if (!g.ok) return g.response
  let logId: unknown
  try {
    logId = ((await req.json()) as { logId?: unknown }).logId
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (typeof logId !== 'number' || !Number.isFinite(logId)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // user_id で必ず絞る。id だけで更新できると、他人の記録を書き換えられる。
  const { error } = await g.admin().from('ask_shelf_queries')
    .update({ submitted: true }).eq('id', logId).eq('user_id', g.userId)
  if (error) return serverError('log の更新に失敗', error)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: 段の画面を作り、検索結果に差し込む**

`src/components/AskShelfPanel.tsx` を新規に作る。上の「画面の決まり」をすべて満たすこと。骨は次のとおり。

```tsx
'use client'
import { useEffect, useState } from 'react'
import { isAskShelfEnabled } from '@/lib/ask-shelf-flag'
import type { ShelfResult } from '@/lib/ask-shelf/rank'

export function AskShelfPanel({ query, onRequest }: { query: string; onRequest: (logId: number | null) => void }) {
  const [data, setData] = useState<(ShelfResult & { logId: number | null }) | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!isAskShelfEnabled() || !query.trim()) { setData(null); return }
    let alive = true
    fetch('/api/ask-shelf/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setData(j) })
      // 段0が落ちても既存の検索結果は出したままにする（機能の追加で既存動線を壊さない）。
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [query])

  if (!data) return null
  // 3層とも空で、決まった1行も無い（＝問いが空）なら何も描かない。
  if (!data.emptyMessage && data.claims.length === 0 && data.sections.length === 0 && data.board.length === 0) return null
  // ここから先で、層1 → 層2 → 層3 → 依頼ボタンの順に描く。
  // 本文は bodyVisible が true のときだけ描く（false のときは題名と節名まで）。
  // …
}
```

`src/app/page.tsx` の検索結果の描画で、既存のページ結果カード列の**上**に `<AskShelfPanel query={…} onRequest={…} />` を置く。`onRequest` は依頼モーダルを開き、`/api/ask-shelf/log` に `logId` を送る。既存の `CqCaptureSuggestion`（1162行付近）は**残す**。段が出ないとき（フラグが閉じている・問いが空）に従来どおり動く必要があるため。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-log-route.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS（4件）、型エラー0、本番ビルド成功

```bash
git add src/components/AskShelfPanel.tsx src/app/page.tsx src/app/api/ask-shelf/log src/lib/__tests__/ask-shelf-log-route.test.ts
git commit -m "feat(ask-shelf): 検索タブに主張の段を足す（フラグの内側・既存の動線は残す）"
```

---

## Task 9: 利用者に見える4状態と見送りの理由

**Files:**
- Create: `src/lib/ask-shelf/intake-columns.ts`
- Modify: `src/lib/cq-dispatch.ts`（`dispatchLabel` に closed を足す）
- Modify: `src/lib/cq-mine.ts`（`MySubmission` に理由を足す）
- Test: `src/lib/__tests__/ask-shelf-intake-columns.test.ts`、`src/lib/__tests__/cq-dispatch.test.ts`（既存に追記）

**Interfaces:**
- Consumes: `NotionIntakePage`（`src/lib/cq-board.ts`）、`MyStage`（`src/lib/cq-mine.ts`）
- Produces:
  - `export const DECLINE_REASONS = ['MediNode の対象外', '個別の症例の判断による', '既存の記事で答えられる', '根拠を確認できない', 'いまの制作範囲では扱えない'] as const`
  - `type DeclineReason = (typeof DECLINE_REASONS)[number]`
  - `readIntakeColumns(page: NotionIntakePage): { shelfResult: string; shelfClaimIds: string[]; canonicalClaimIds: string[]; declineReason: DeclineReason | '' }`
  - `buildIntakeShelfProperties(schema, value): Record<string, unknown>`（**無い列は積まない**）
  - `declineMessage(reason: DeclineReason | ''): string`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-intake-columns.test.ts
import { describe, it, expect } from 'vitest'
import { readIntakeColumns, buildIntakeShelfProperties, declineMessage, DECLINE_REASONS } from '@/lib/ask-shelf/intake-columns'

const page = (props: Record<string, unknown>) => ({ id: 'x', properties: props } as never)
const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })

describe('readIntakeColumns', () => {
  it('4つの列を読む', () => {
    const r = readIntakeColumns(page({
      段0結果: { select: { name: '該当なし' } },
      段0主張ID: rich('a1,a2'),
      正本主張ID: rich('c9'),
      見送りの理由: { select: { name: '根拠を確認できない' } },
    }))
    expect(r.shelfResult).toBe('該当なし')
    expect(r.shelfClaimIds).toEqual(['a1', 'a2'])
    expect(r.canonicalClaimIds).toEqual(['c9'])
    expect(r.declineReason).toBe('根拠を確認できない')
  })

  it('列がまったく無い受付DBでも落ちない（既存の受付DBを壊さない）', () => {
    const r = readIntakeColumns(page({}))
    expect(r).toEqual({ shelfResult: '', shelfClaimIds: [], canonicalClaimIds: [], declineReason: '' })
  })

  it('知らない理由の文字列は空として扱う（選択肢の改名に引きずられない）', () => {
    expect(readIntakeColumns(page({ 見送りの理由: { select: { name: '謎の理由' } } })).declineReason).toBe('')
  })
})

describe('buildIntakeShelfProperties', () => {
  it('受付DBに無い列は積まない', () => {
    const props = buildIntakeShelfProperties({ 段0結果: { type: 'select' } }, { shelfResult: '該当なし', shelfClaimIds: ['a1'] })
    expect(Object.keys(props)).toEqual(['段0結果'])
  })
  it('型が違う列にも積まない', () => {
    const props = buildIntakeShelfProperties({ 段0主張ID: { type: 'select' } }, { shelfResult: '', shelfClaimIds: ['a1'] })
    expect(props).toEqual({})
  })
})

describe('declineMessage', () => {
  it('5つの理由すべてに文がある', () => {
    for (const r of DECLINE_REASONS) expect(declineMessage(r).length).toBeGreaterThan(0)
  })
  it('理由が無いときは理由なしの文になる', () => {
    expect(declineMessage('')).toBe('今回は記事化しません。')
  })
})
```

```ts
// src/lib/__tests__/cq-dispatch.test.ts の末尾に追記
it('対応不要は「今回は記事化しません」と理由を出す', () => {
  expect(dispatchLabel({ sentAt: '2026-09-01', voteCount: null, stage: 'closed' }))
    .toBe('今回は記事化しません')
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-intake-columns.test.ts src/lib/__tests__/cq-dispatch.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/intake-columns.ts
// 受付DBに足した4列の読み書き。既存の列は触らない。
// buildIntakeProperties と同じ約束: 受付DBに無い列・型が違う列には積まない
// （列を足す前でも既存の投稿経路が壊れないため）。
import type { NotionIntakePage } from '../cq-board'

// 「見送りの理由」の選択肢。Notion 側の選択肢名と一字一句そろえる。
// ⚠️ 改名は「削除＋新規作成」になり、付いていた行から静かに外れる（2026-09-03 に2回発生）。
// 増やすときは末尾に足す。既存の名前を変えない。
export const DECLINE_REASONS = [
  'MediNode の対象外',
  '個別の症例の判断による',
  '既存の記事で答えられる',
  '根拠を確認できない',
  'いまの制作範囲では扱えない',
] as const
export type DeclineReason = (typeof DECLINE_REASONS)[number]

type Prop = Record<string, unknown> | undefined
const propOf = (p: NotionIntakePage, name: string): Prop =>
  (p.properties?.[name] as Record<string, unknown> | undefined) ?? undefined

function plainText(p: Prop): string {
  const arr = p?.rich_text
  if (!Array.isArray(arr)) return ''
  return arr.map((t) => String((t as { plain_text?: unknown })?.plain_text ?? '')).join('').trim()
}
function selectName(p: Prop): string {
  const sel = p?.select as { name?: unknown } | null | undefined
  return sel?.name ? String(sel.name) : ''
}
const ids = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

export function readIntakeColumns(page: NotionIntakePage): {
  shelfResult: string
  shelfClaimIds: string[]
  canonicalClaimIds: string[]
  declineReason: DeclineReason | ''
} {
  const reason = selectName(propOf(page, '見送りの理由'))
  return {
    shelfResult: selectName(propOf(page, '段0結果')),
    shelfClaimIds: ids(plainText(propOf(page, '段0主張ID'))),
    canonicalClaimIds: ids(plainText(propOf(page, '正本主張ID'))),
    // 固定リストに無い文字列は空として扱う。Notion 側で選択肢が改名されても、
    // 見覚えのない理由を利用者に見せない（安全側）。
    declineReason: (DECLINE_REASONS as readonly string[]).includes(reason) ? (reason as DeclineReason) : '',
  }
}

export type IntakePropSchemaLite = Record<string, { type?: string } | undefined>

export function buildIntakeShelfProperties(
  schema: IntakePropSchemaLite,
  value: { shelfResult: string; shelfClaimIds: string[] },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (value.shelfResult && schema['段0結果']?.type === 'select') {
    out['段0結果'] = { select: { name: value.shelfResult } }
  }
  if (value.shelfClaimIds.length && schema['段0主張ID']?.type === 'rich_text') {
    out['段0主張ID'] = { rich_text: [{ text: { content: value.shelfClaimIds.join(',') } }] }
  }
  return out
}

// 利用者に見せる文。作者の内部の言葉をそのまま出さない。
export function declineMessage(reason: DeclineReason | ''): string {
  switch (reason) {
    case 'MediNode の対象外':
      return '今回は記事化しません。MediNodeが扱う範囲の外の問いでした。'
    case '個別の症例の判断による':
      return '今回は記事化しません。個別の症例の判断による部分が大きく、一般化した主張にできませんでした。'
    case '既存の記事で答えられる':
      return '既にある記事で答えられます。該当箇所をご案内します。'
    case '根拠を確認できない':
      return '今回は記事化しません。裏づけになる一次資料を確認できませんでした。'
    case 'いまの制作範囲では扱えない':
      return '今回は記事化しません。いまの制作の範囲では扱えませんでした。'
    default:
      return '今回は記事化しません。'
  }
}
```

```ts
// src/lib/cq-dispatch.ts の dispatchLabel を差し替え
export function dispatchLabel(state: DispatchState | undefined): string {
  if (!state) return ''
  if (state.stage === 'answered') return '答えが出ました'
  // 「対応不要」を「届いています」のまま置かない。待っている人に終わりが見えないのが
  // いちばんの負債だった（提案005 の「先に知っておくべき3つのこと」の3番）。
  if (state.stage === 'closed') return '今回は記事化しません'
  if (state.voteCount && state.voteCount > 0) {
    return `${state.voteCount}人が同じことを気にしています`
  }
  return '作者に届いています'
}
```

`src/lib/cq-mine.ts` の `MySubmission` に `declineReason: DeclineReason | ''` を足し、`toMySubmissions` で `readIntakeColumns(page).declineReason` を写す。既存のテストが落ちたら、期待値に `declineReason: ''` を足す（判定そのものは変えない）。

- [ ] **Step 4: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-intake-columns.test.ts src/lib/__tests__/cq-dispatch.test.ts src/lib/__tests__/cq-mine.test.ts && npx tsc --noEmit`
Expected: すべて PASS

```bash
git add src/lib/ask-shelf/intake-columns.ts src/lib/cq-dispatch.ts src/lib/cq-mine.ts src/lib/__tests__/
git commit -m "feat(ask-shelf): 利用者に見える状態を4つにし、見送りの理由を出す"
```

---

## Task 10: /admin の「聞ける棚」パネル

**Files:**
- Create: `src/app/admin/AskShelfAdminPanel.tsx`
- Create: `src/app/api/admin/ask-shelf/intake/route.ts`（一覧の取得と受付DBへの書き戻し）
- Modify: `src/app/admin/page.tsx`（パネルを1つ足す）
- Test: `src/lib/__tests__/admin-ask-shelf-route.test.ts`

**Interfaces:**
- Consumes: Task 9 の `readIntakeColumns`・`DECLINE_REASONS`、既存の管理者判定（`COMP_ADMIN_EMAILS`。`src/lib/admin-daily.ts` と同じ経路）
- Produces: `GET /api/admin/ask-shelf/intake` … `{ items: { id, question, background, stage, onBoard, shelfResult, canonicalClaimIds, declineReason, createdAt }[] }` / `PATCH` … 入力 `{ id, onBoard?, status?, declineReason?, canonicalClaimIds? }`

**画面の決まり**

- 一覧は受付DBの未対応を新しい順。**段0結果＝該当なし で絞れるフィルタを1つ置く**（これが「空白候補ビュー」。独立した保管場所は作らない）
- 各行で、ボード公開の切替／対応状態（対応済み・対応不要）／見送りの理由（5つの選択）／正本の主張の選択
- **正本の主張の選択は語で検索して選ぶ。**24文字の鍵を手で入力させない（写し間違いは誰にも気づかれず、通知が飛ばないだけになる）。候補は `/api/ask-shelf/search` を流用する
- 書き込み先は Notion の受付DB。Supabase に別の真実を作らない
- **制作工程との受け渡しは、このパネルの2か所だけで完結させる**（`medinode-cq-note` スキルの中身は変えない）。
  入口＝空白候補の行から疑問文と背景をコピーできるボタン。出口＝正本の主張を選ぶと
  「対応状態＝対応済み」と「正本主張ID」が同時に書かれること

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/admin-ask-shelf-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { admin: true, patched: [] as Record<string, unknown>[] }
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: async () => (state.admin ? { ok: true } : { ok: false }) }))
vi.mock('@/lib/notion-intake', () => ({
  listIntakePages: async () => [{
    id: 'i1',
    properties: {
      疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
      対応状態: { select: null },
      ボード公開: { checkbox: false },
      段0結果: { select: { name: '該当なし' } },
    },
  }],
  updateIntakePage: async (id: string, props: Record<string, unknown>) => { state.patched.push({ id, props }) },
}))

const route = await import('@/app/api/admin/ask-shelf/intake/route')
beforeEach(() => { state.admin = true; state.patched = [] })

describe('/api/admin/ask-shelf/intake', () => {
  it('管理者でなければ403', async () => {
    state.admin = false
    expect((await route.GET()).status).toBe(403)
  })
  it('未対応の依頼を段0結果つきで返す', async () => {
    const json = await (await route.GET()).json()
    expect(json.items[0].question).toBe('ショックの見分け方は？')
    expect(json.items[0].shelfResult).toBe('該当なし')
  })
  it('正本の主張を書き戻すときは対応済みも一緒に書く', async () => {
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: 'i1', canonicalClaimIds: ['c9'] }) })
    expect((await route.PATCH(req)).status).toBe(200)
    const props = state.patched[0].props as Record<string, unknown>
    expect(props['正本主張ID']).toBeTruthy()
    expect(props['対応状態']).toEqual({ select: { name: '対応済み' } })
  })
  it('固定リストに無い見送りの理由は受け付けない', async () => {
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: 'i1', declineReason: '謎' }) })
    expect((await route.PATCH(req)).status).toBe(400)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/admin-ask-shelf-route.test.ts`
Expected: FAIL（route が無い）

- [ ] **Step 3: 実装する**

受付DBの読み書きは、既存の `src/app/api/cq/submit/route.ts` が使っている Notion クライアントの作り方（`CQ_INTAKE_NOTION_TOKEN` と `CQ_INTAKE_DB_ID`）をそのまま使い、`src/lib/notion-intake.ts` に `listIntakePages()` と `updateIntakePage(id, props)` の2つだけを切り出す。管理者判定は既存の経路（`COMP_ADMIN_EMAILS`）に合わせる。

`PATCH` の要点。

- `canonicalClaimIds` が来たら、`正本主張ID` と同時に `対応状態 = 対応済み` を書く。片方だけ書かれた状態を作らない（**通知の合図はこの2つが揃うこと**＝継ぎ目5）
- `declineReason` は `DECLINE_REASONS` に含まれる文字列だけ受ける。含まれなければ 400
- `declineReason === '既存の記事で答えられる'` のときは `対応状態 = 対応済み`、それ以外の理由のときは `対応不要`（設計書の判断）
- 受付DBに無い列には積まない（`buildIntakeShelfProperties` と同じ約束）

- [ ] **Step 4: 画面を作って /admin に足す**

`AskShelfAdminPanel.tsx` を作り、`src/app/admin/page.tsx` にパネルを1つ足す。既存のパネルの並べ方と見た目に合わせる（`DESIGN.md` があればそれに従う）。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/admin-ask-shelf-route.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS（4件）、型エラー0、ビルド成功

```bash
git add src/app/admin src/app/api/admin/ask-shelf src/lib/notion-intake.ts src/lib/__tests__/admin-ask-shelf-route.test.ts
git commit -m "feat(ask-shelf): /admin に聞ける棚のパネルを足す（空白候補と正本の主張の紐づけ）"
```

---

## Task 11: 回答通知の飛び先（純関数）

**Files:**
- Create: `src/lib/ask-shelf/landing.ts`
- Test: `src/lib/__tests__/ask-shelf-landing.test.ts`

**Interfaces:**
- Consumes: `APP_URL`（`src/lib/trial-end-content.ts`）
- Produces:
  - `type AnswerTarget = { kind: 'claim'; claimId: string; pageId: string; sectionKey: string } | { kind: 'article'; pageId: string } | { kind: 'none' }`
  - **`section` の種別は置かない。** 主張が `recall_claims` に無ければ節も分からないので、到達できない分岐になる（recall-dex の教訓: 使われない引数と死んだ分岐を残さない）
  - `resolveAnswerTarget(input: { canonicalClaimIds: string[]; claimsById: Map<string, { pageId: string; sectionKey: string }>; articlePageId?: string }): AnswerTarget`
  - `answerLandingUrl(intakePageId: string, target: AnswerTarget): string`

**設計からの精緻化（実装で確かめた点）:** アプリには「記事の特定の節を URL で開く」経路が無い。リーダーは `objectID`（`subscription_<pageId>`）でアプリ内から開く作りで、`src/lib/vine-open.ts` もその形を使っている。よって**飛び先の URL は着地画面1つにまとめ、「主張＞節＞記事」の順位は着地画面が何を見せるかとして表す**。順位の意味は設計書のまま変わらない。何も分からないときだけ、従来どおりアプリの入口へ飛ばす。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-landing.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAnswerTarget, answerLandingUrl } from '@/lib/ask-shelf/landing'
import { APP_URL } from '@/lib/trial-end-content'

const claims = new Map([['c9', { pageId: 'p1', sectionKey: 'sec3' }]])

describe('resolveAnswerTarget', () => {
  it('正本の主張が棚にあれば主張を指す（いちばん具体的）', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['c9'], claimsById: claims }))
      .toEqual({ kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' })
  })
  it('主張が棚に無く記事だけ分かるときは記事を指す', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['missing'], claimsById: claims, articlePageId: 'p2' }))
      .toEqual({ kind: 'article', pageId: 'p2' })
  })
  it('何も分からなければ none', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: [], claimsById: claims })).toEqual({ kind: 'none' })
  })
  it('主張IDが複数あるときは、棚にある最初の1つを指す', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['missing', 'c9'], claimsById: claims }))
      .toEqual({ kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' })
  })
})

describe('answerLandingUrl', () => {
  it('見せるものがあるときは着地画面へ', () => {
    expect(answerLandingUrl('i1', { kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' }))
      .toBe(`${APP_URL}/cq/answered/i1`)
  })
  it('何も分からないときは従来どおりアプリの入口へ', () => {
    expect(answerLandingUrl('i1', { kind: 'none' })).toBe(APP_URL)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-landing.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/landing.ts
// 回答通知の飛び先。いちばん具体的なもの（主張＞節＞記事）を指す。
//
// URL は着地画面 /cq/answered/[id] の1つにまとめる。アプリには「記事の特定の節を
// URL で開く」経路が無く（リーダーは objectID でアプリ内から開く。vine-open.ts 参照）、
// ここで URL の形を新しく作ると、リーダー側の開き方と二重の規約になるため。
// 「主張＞節＞記事」の順位は、着地画面が何を見せるかとして表す。
import { APP_URL } from '../trial-end-content'

// 'section' の種別は置かない。主張が recall_claims に無ければ節も分からないため、
// 到達できない分岐になる。節を指せるのは主張が見つかったときだけ。
export type AnswerTarget =
  | { kind: 'claim'; claimId: string; pageId: string; sectionKey: string }
  | { kind: 'article'; pageId: string }
  | { kind: 'none' }

export function resolveAnswerTarget(input: {
  canonicalClaimIds: string[]
  claimsById: Map<string, { pageId: string; sectionKey: string }>
  articlePageId?: string
}): AnswerTarget {
  for (const id of input.canonicalClaimIds) {
    const c = input.claimsById.get(id)
    // 節が分かる主張が最優先。節が空の主張なら、その記事の先頭に落とす。
    if (c) {
      return c.sectionKey
        ? { kind: 'claim', claimId: id, pageId: c.pageId, sectionKey: c.sectionKey }
        : { kind: 'article', pageId: c.pageId }
    }
  }
  if (input.articlePageId) return { kind: 'article', pageId: input.articlePageId }
  return { kind: 'none' }
}

export function answerLandingUrl(intakePageId: string, target: AnswerTarget): string {
  if (target.kind === 'none') return APP_URL
  return `${APP_URL}/cq/answered/${intakePageId}`
}
```

- [ ] **Step 4: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-landing.test.ts && npx tsc --noEmit`
Expected: PASS（6件）

```bash
git add src/lib/ask-shelf/landing.ts src/lib/__tests__/ask-shelf-landing.test.ts
git commit -m "feat(ask-shelf): 回答通知の飛び先を決める純関数を足す"
```

---

## Task 12: 通知 cron に飛び先・プッシュ・「残した」を足す

**Files:**
- Modify: `src/lib/cq-answer-notify.ts`
- Modify: `src/app/api/cron/cq-answer-notify/route.ts`
- Test: `src/lib/__tests__/cq-answer-notify.test.ts`（既存に追記）

**Interfaces:**
- Consumes: Task 9 の `readIntakeColumns`、Task 11 の `resolveAnswerTarget`・`answerLandingUrl`、既存の `sendToUsers`（`src/lib/push-send.ts`。種別 `resolved_cq`）
- Produces: `AnswerNotification` に `canonicalClaimIds: string[]` を足す / `answerNoticeEmail(questions, url)` が飛び先を受ける / `keepRowsFor(userId, claimIds, answeredAt)` … `recall_progress` に書く行を作る純関数

**継ぎ目5でやること**

- 正本化の合図は「対応済み」かつ「正本主張ID が空でない」。空ならメールだけ（従来の振る舞い）
- 依頼者の `recall_progress` に「残した」を書く。`kept_at` は正本化の時刻、**`due_at` は null**（初見をクイズにしない）
- フラグが閉じている依頼者にも書いてよい。画面には出ないだけ
- **メール文面に Recall の名前を出さない**
- プッシュは1件につき1回。重複防止はメールと同じ `user_metadata.cq_answer_notified`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/cq-answer-notify.test.ts の末尾に追記
import { keepRowsFor, answerNoticeEmail } from '@/lib/cq-answer-notify'

describe('keepRowsFor（継ぎ目5）', () => {
  it('due_at を null にして「残したが未開封」にする', () => {
    const rows = keepRowsFor('u1', ['c9'], '2026-09-10T00:00:00.000Z')
    expect(rows).toEqual([{ user_id: 'u1', claim_id: 'c9', kept_at: '2026-09-10T00:00:00.000Z', due_at: null }])
  })
  it('正本主張IDが無ければ1行も作らない（従来どおりメールだけ）', () => {
    expect(keepRowsFor('u1', [], '2026-09-10T00:00:00.000Z')).toEqual([])
  })
})

describe('answerNoticeEmail', () => {
  it('飛び先を本文に入れる', () => {
    const m = answerNoticeEmail(['ショックの見分け方は？'], 'https://example.test/cq/answered/i1')
    expect(m.text).toContain('https://example.test/cq/answered/i1')
  })
  it('Recall の名前を出さない（継ぎ目5）', () => {
    const m = answerNoticeEmail(['ショックの見分け方は？'], 'https://example.test/cq/answered/i1')
    expect(m.text).not.toMatch(/Recall|知の球/)
    expect(m.subject).not.toMatch(/Recall|知の球/)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/cq-answer-notify.test.ts`
Expected: FAIL（`keepRowsFor` が無い／`answerNoticeEmail` が引数を取らない）

- [ ] **Step 3: 純関数を足す**

```ts
// src/lib/cq-answer-notify.ts に追記
import { readIntakeColumns } from './ask-shelf/intake-columns'

// 継ぎ目5。正本になった主張を、依頼者の手元に「残した」状態で入れる行を作る。
// due_at は null。依頼者がその主張か節を初めて開いた時点で「間隔1日・期限翌日」に
// 設定する（初見をいきなり伏せ字のクイズにしない）。
// フラグが閉じている依頼者にも書いてよい。画面に出ないだけで、開いたときに最初から灯る。
export function keepRowsFor(
  userId: string,
  claimIds: string[],
  answeredAt: string,
): Array<{ user_id: string; claim_id: string; kept_at: string; due_at: null }> {
  return claimIds.map((claim_id) => ({ user_id: userId, claim_id, kept_at: answeredAt, due_at: null }))
}
```

`answeredNotifications` の戻り値に `canonicalClaimIds: readIntakeColumns(page).canonicalClaimIds` を足す。
`answerNoticeEmail(questions: string[], url: string)` に引数を1つ足し、本文の `APP_URL` を `url` に差し替える。既存の呼び出しは `answerNoticeEmail(qs, APP_URL)` にして振る舞いを保つ。

- [ ] **Step 4: cron を書き換える**

`src/app/api/cron/cq-answer-notify/route.ts` の流れに3つ足す。

1. `recall_claims` から `claim_id, page_id, section_key` を読み、`claimsById` の Map を作る（1回だけ）
2. 依頼ごとに `resolveAnswerTarget` → `answerLandingUrl` を求め、メール本文に入れる
3. メールを送ったのと同じ分岐で、
   - `recall_progress` に `keepRowsFor(...)` を upsert（`onConflict: 'user_id,claim_id'`。**既にある行は上書きしない**。自分で残していた主張の段や期限を、通知が巻き戻してはいけない → `ignoreDuplicates: true`）
   - `sendToUsers(admin, [userId], 'resolved_cq', { title: 'MediNode', body: '投稿された臨床疑問に回答がつきました', url })` を呼ぶ
   - プッシュの失敗でメールの成否を変えない（`try/catch` で握り、ログに残す）

応答 JSON に `pushed` と `kept` を足す（オーナーが手動実行で見る数）。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/cq-answer-notify.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS、型エラー0、ビルド成功

```bash
git add src/lib/cq-answer-notify.ts src/app/api/cron/cq-answer-notify src/lib/__tests__/cq-answer-notify.test.ts
git commit -m "feat(ask-shelf): 回答通知に飛び先・プッシュ・「残した」の書き込みを足す

recall_progress は ignoreDuplicates で入れる。自分で残していた主張の段や期限を
通知が巻き戻さないため。"
```

---

## Task 13: 回答の着地画面

**Files:**
- Create: `src/app/cq/answered/[id]/page.tsx`
- Create: `src/app/api/ask-shelf/answered/[id]/route.ts`
- Test: `src/lib/__tests__/ask-shelf-answered-route.test.ts`

**Interfaces:**
- Consumes: Task 9 の `readIntakeColumns`、Task 11 の `resolveAnswerTarget`
- Produces: `GET /api/ask-shelf/answered/[id]` … `{ question, answer: { claimId, body, source, confidence, pageId, pageTitle, sectionKey, sectionHeading } | null, target: AnswerTarget, kept: boolean }`

**画面に並べる4つ**（更新案E）: 自分が送った疑問 / 回答＝正本の主張 / 根拠＝出典 / 「残す」と「この節を読む」

**必ず守ること**

- **本人だけが開ける。** 受付DBの `通知先ユーザーID` とログイン中の利用者が一致しなければ 404。他人の疑問は1文字も返さない
- 「この節を読む」を押した時点で、`due_at` が null の `recall_progress` を「間隔1日・期限翌日」にする（継ぎ目5）。既存の `/api/recall/read` か新しい1本のどちらでもよいが、**期限の計算式は Recall 設計の `srs.ts` を使う**（式を二重に持たない）
- `ask_shelf` が閉じていても、この画面は開ける必要がある（通知はフラグの外にも飛びうる）。ただし「残す」の操作は `recall` の内側でだけ描く

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-answered-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  user: { id: 'u1' } as { id: string } | null,
  page: null as Record<string, unknown> | null,
  claims: [] as Record<string, unknown>[],
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: state.claims, error: null }), limit: async () => ({ data: state.claims, error: null }) }) }) }),
  }),
}))
vi.mock('@/lib/notion-intake', () => ({ getIntakePage: async () => state.page }))

const { GET } = await import('@/app/api/ask-shelf/answered/[id]/route')
const call = (id: string) => GET(new Request('http://x'), { params: Promise.resolve({ id }) })

const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })
beforeEach(() => {
  state.user = { id: 'u1' }
  state.claims = [{ claim_id: 'c9', page_id: 'p1', page_title: '💡 ショックの問い', section_key: 'sec3', section_heading: '3. 判定', body: '乳酸値2 mmol/L超を目安にする', source: 'ESICM 2014', confidence: 'ok' }]
  state.page = {
    id: 'i1',
    properties: {
      疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
      通知先ユーザーID: rich('u1'),
      対応状態: { select: { name: '対応済み' } },
      正本主張ID: rich('c9'),
    },
  }
})

describe('GET /api/ask-shelf/answered/[id]', () => {
  it('本人には疑問と回答を返す', async () => {
    const json = await (await call('i1')).json()
    expect(json.question).toBe('ショックの見分け方は？')
    expect(json.answer.claimId).toBe('c9')
    expect(json.answer.source).toBe('ESICM 2014')
  })
  it('他人には404（1文字も返さない）', async () => {
    state.user = { id: 'u2' }
    const res = await call('i1')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
  it('未ログインは401', async () => {
    state.user = null
    expect((await call('i1')).status).toBe(401)
  })
  it('正本主張IDが無ければ answer は null（画面は疑問と状態だけ出す）', async () => {
    ;(state.page!.properties as Record<string, unknown>)['正本主張ID'] = rich('')
    const json = await (await call('i1')).json()
    expect(json.answer).toBeNull()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-answered-route.test.ts`
Expected: FAIL（route が無い）

- [ ] **Step 3: API と画面を実装する**

上の「必ず守ること」を満たす形で `route.ts` と `page.tsx` を書く。`page.tsx` は API を1本呼び、4つを縦に並べる。

- [ ] **Step 4: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-answered-route.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS（4件）、型エラー0、ビルド成功

```bash
git add src/app/cq/answered src/app/api/ask-shelf/answered src/lib/__tests__/ask-shelf-answered-route.test.ts
git commit -m "feat(ask-shelf): 回答の着地画面を足す（疑問・回答・根拠・残す）"
```

---

## Task 14: 依頼画面の文言と投稿前の注意5点

**Files:**
- Create: `src/lib/ask-shelf/copy.ts`
- Modify: `src/components/CqCapture.tsx`
- Modify: `src/app/page.tsx`（ゼロ件のボタン・右下の丸・記事内の丸）
- Modify: `src/lib/cq-answer-notify.ts`（メール件名）
- Test: `src/lib/__tests__/ask-shelf-copy.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `ASK_SHELF_REQUEST_LABEL`・`ASK_SHELF_MODAL_TITLE`・`ASK_SHELF_NOTICES`（5要素）・`ASK_SHELF_DONE_MESSAGE`・`ASK_SHELF_MAIL_SUBJECT`

**同時に変える場所（1つでも残すと言葉が割れる）**

1. 6つの入口のボタン（検索ゼロ件／画面右下の丸／記事内の丸／設定の「臨床疑問を投稿する」／未解決の問い画面のパネル／同画面の空のとき）
2. モーダルの見出しと、送信ボタンの上の注意5点（畳まない）
3. 完了画面（「専門医に届きました」を差し替える）
4. 回答通知メールの件名と本文
5. 背景欄の例文（注意3と矛盾しない書き方に直す）
6. 外部 Notion フォームの説明文（文案を出す。Notion 側はオーナーが直す）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-copy.test.ts
import { describe, it, expect } from 'vitest'
import { ASK_SHELF_NOTICES, ASK_SHELF_REQUEST_LABEL, ASK_SHELF_DONE_MESSAGE } from '@/lib/ask-shelf/copy'

describe('依頼画面の文言', () => {
  it('注意はちょうど5点', () => {
    expect(ASK_SHELF_NOTICES).toHaveLength(5)
  })
  it('「専門医」という言い方をどこにも残さない', () => {
    const all = [ASK_SHELF_REQUEST_LABEL, ASK_SHELF_DONE_MESSAGE, ...ASK_SHELF_NOTICES].join('\n')
    expect(all).not.toContain('専門医')
  })
  it('ボタンは「MediNodeに足してほしい疑問」の言葉で書く', () => {
    expect(ASK_SHELF_REQUEST_LABEL).toContain('MediNodeに足してほしい疑問')
  })
  it('注意に、個別の助言・緊急・患者の特定・全部は記事にならない・公開と期限の5つが入っている', () => {
    const all = ASK_SHELF_NOTICES.join('\n')
    for (const word of ['個別', '急', '特定', '記事になる', '公開']) expect(all).toContain(word)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-copy.test.ts`
Expected: FAIL

- [ ] **Step 3: 文言を1か所に置く**

```ts
// src/lib/ask-shelf/copy.ts
// 依頼まわりの文言。ボタン・モーダル・完了画面・メールが同じ言葉を使うように1か所で持つ。
// 「専門医に訊く」をやめたのは、個別の回答を約束していると読めるため（裁定5）。
// MediNode がしているのは「棚に主張を足すこと」で、個別の相談に答えることではない。

export const ASK_SHELF_REQUEST_LABEL = 'MediNodeに足してほしい疑問を送る'
export const ASK_SHELF_MODAL_TITLE = 'MediNodeに足してほしい疑問'

// 送信ボタンの上に、畳まずに常時出す5点。
export const ASK_SHELF_NOTICES = [
  '個別の患者さんへの診療の助言はできません',
  '急いでいる判断には間に合いません',
  '患者さんが特定できることは書かないでください',
  'すべてが記事になるわけではありません',
  '記事になったら公開されます。いつまでに、の約束はできません',
] as const

export const ASK_SHELF_DONE_MESSAGE = 'MediNodeに足してほしい疑問として受け付けました'
export const ASK_SHELF_MAIL_SUBJECT = 'MediNodeへご投稿いただいた臨床疑問に回答がつきました'

// 背景欄の例文。「患者背景」を促す旧文は注意3と矛盾するので、場面と経過に寄せる。
export const ASK_SHELF_BACKGROUND_PLACEHOLDER = 'どんな場面で迷ったか、何を調べたか（患者さんが特定できることは書かないでください）'

// 外部 Notion フォームの説明文の文案（Notion 側はオーナーが手で直す）。
export const ASK_SHELF_EXTERNAL_FORM_TEXT = [
  'MediNodeに足してほしい疑問を送るフォームです。',
  ...ASK_SHELF_NOTICES.map((n) => `・${n}`),
].join('\n')
```

- [ ] **Step 4: 6か所を差し替える**

`grep -rn "専門医に訊" src` と `grep -rn "専門医に届" src` の結果が**0件になるまで**差し替える。完了画面・メール件名・背景欄の例文も同じ定数から取る。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-copy.test.ts && grep -rn "専門医" src | grep -v __tests__ ; npx tsc --noEmit && npm run build`
Expected: テスト PASS、grep は0件、型エラー0、ビルド成功

```bash
git add src/lib/ask-shelf/copy.ts src/components/CqCapture.tsx src/app/page.tsx src/lib/cq-answer-notify.ts src/lib/__tests__/ask-shelf-copy.test.ts
git commit -m "feat(ask-shelf): 依頼画面を「MediNodeに足してほしい疑問」の言葉に統一し、投稿前の注意5点を出す"
```

---

## Task 15: 月5件の上限と掲載名の希望

**Files:**
- Create: `src/lib/ask-shelf/monthly-limit.ts`
- Modify: `src/app/api/cq/submit/route.ts`
- Modify: `src/lib/cq-submit.ts`（掲載名の希望を積む）
- Modify: `src/components/CqCapture.tsx`（板に出すときの名前の選択）
- Test: `src/lib/__tests__/ask-shelf-monthly-limit.test.ts`、`src/lib/__tests__/cq-submit.test.ts`（既存に追記）

**Interfaces:**
- Consumes: 受付DBの一覧（`listIntakePages`）
- Produces: `MONTHLY_LIMIT = 5` / `countRecentSubmissions(pages, userId, now): number` / `monthlyLimitState(count): { blocked: boolean; remaining: number; notice: string | null }`

**なぜ受付DBを数えるのか:** Upstash（Redis）が本番に設定された記録が無い。未設定だと `rate-limit.ts` はメモリ版に落ち、サーバーが入れ替わるたびにカウンタが消えるため30日の窓を保てない。受付DBは投稿そのものの記録なので、数え直しても正しい。1日5件と1IP20件の既存の制限は**そのまま残す**。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-monthly-limit.test.ts
import { describe, it, expect } from 'vitest'
import { countRecentSubmissions, monthlyLimitState, MONTHLY_LIMIT } from '@/lib/ask-shelf/monthly-limit'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const page = (userId: string, created: string) => ({
  id: created, created_time: created,
  properties: { 通知先ユーザーID: { rich_text: [{ plain_text: userId }] } },
} as never)

describe('countRecentSubmissions', () => {
  it('直近30日の自分の投稿だけを数える', () => {
    const pages = [page('u1', '2026-09-29T00:00:00Z'), page('u1', '2026-08-01T00:00:00Z'), page('u2', '2026-09-29T00:00:00Z')]
    expect(countRecentSubmissions(pages, 'u1', NOW)).toBe(1)
  })
  it('ちょうど30日前は窓の中に入れる', () => {
    expect(countRecentSubmissions([page('u1', '2026-08-31T00:00:01Z')], 'u1', NOW)).toBe(1)
  })
  it('通知に同意していない投稿は数えられない（紐付けが無い）', () => {
    expect(countRecentSubmissions([page('', '2026-09-29T00:00:00Z')], 'u1', NOW)).toBe(0)
  })
})

describe('monthlyLimitState', () => {
  it('上限に達したら止める', () => {
    expect(monthlyLimitState(MONTHLY_LIMIT).blocked).toBe(true)
  })
  it('残り1件のときだけ案内を出す（ふだんは黙っている）', () => {
    expect(monthlyLimitState(MONTHLY_LIMIT - 1).notice).toContain('あと1件')
    expect(monthlyLimitState(0).notice).toBeNull()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-monthly-limit.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/monthly-limit.ts
// 月5件の上限（裁定6）。1日5件・1IP20件の既存の制限は残したうえで足す。
//
// 数える場所を Upstash ではなく受付DBにした理由: Upstash が本番に設定された記録が無く、
// 未設定だと rate-limit.ts はメモリ版に落ちる。サーバーが入れ替わるたびにカウンタが
// 消えるので30日の窓を保てない。受付DBは投稿そのものの記録なので数え直しても正しい。
//
// 通知に同意していない投稿は「通知先ユーザーID」が無く、数に入らない。同意の線引きを
// 機能のために広げない（cq-submit の既存方針）。そのぶんは1日5件と1IP20件が受ける。
import type { NotionIntakePage } from '../cq-board'

export const MONTHLY_LIMIT = 5
const WINDOW_DAYS = 30

export function countRecentSubmissions(pages: NotionIntakePage[], userId: string, now: Date): number {
  if (!userId) return 0
  const from = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  let n = 0
  for (const p of pages) {
    const arr = (p.properties?.['通知先ユーザーID'] as { rich_text?: Array<{ plain_text?: unknown }> } | undefined)?.rich_text
    const owner = Array.isArray(arr) ? arr.map((t) => String(t?.plain_text ?? '')).join('').trim() : ''
    if (owner !== userId) continue
    const t = Date.parse(p.created_time || '')
    if (Number.isFinite(t) && t >= from) n++
  }
  return n
}

export function monthlyLimitState(count: number): { blocked: boolean; remaining: number; notice: string | null } {
  const remaining = Math.max(MONTHLY_LIMIT - count, 0)
  if (remaining === 0) {
    return { blocked: true, remaining, notice: '今月お送りいただける件数の上限に達しました。来月またお待ちしています。' }
  }
  // 案内は上限に近づいたときだけ（裁定6）。ふだんは数を見せない。
  return { blocked: false, remaining, notice: remaining === 1 ? '今月お送りいただけるのは、あと1件です。' : null }
}
```

`src/app/api/cq/submit/route.ts` で、既存の1日5件・1IP20件の判定の**あと**にこの判定を足し、超えていれば 429 と `monthlyLimitState().notice` を返す。

掲載名の希望は `src/lib/cq-submit.ts` の `buildIntakeProperties` に1つ足す。

```ts
// buildIntakeProperties に追記。列が無ければ積まない（既存の約束）。
// 「掲載名の希望」は cq-board.ts が既に読んでおり、未選択なら匿名（安全側）のまま。
// アプリからの投稿がこれを書いていなかったため、板では常に匿名になっていた。
if (value.penNameVisible && schema['掲載名の希望']?.type === 'select') {
  properties['掲載名の希望'] = { select: { name: PEN_NAME_ALLOWED } }
}
```

`PEN_NAME_ALLOWED` は `src/lib/cq-board.ts` から輸入する（値を二重に持たない）。`CqCapture` に「板に出すときの名前」（匿名／ペンネーム）の選択を置き、ペンネームを選んだときだけ `penNameVisible: true` を送る。

- [ ] **Step 4: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-monthly-limit.test.ts src/lib/__tests__/cq-submit.test.ts && npx tsc --noEmit`
Expected: PASS

```bash
git add src/lib/ask-shelf/monthly-limit.ts src/app/api/cq/submit src/lib/cq-submit.ts src/components/CqCapture.tsx src/lib/__tests__/
git commit -m "feat(ask-shelf): 月5件の上限と、アプリ投稿の掲載名の希望を足す

上限は受付DBを数える。Upstash が本番に無く、メモリ版では30日の窓を保てないため。"
```

---

## Task 16: 経験年数・診療科のアカウント保存と /admin の属性別集計

**Files:**
- Modify: `src/lib/account-profile.ts`
- Modify: `src/components/CqCapture.tsx`（初期値をアカウントから取る）
- Modify: `src/app/admin/`（属性別集計を1つ足す）
- Test: `src/lib/__tests__/account-profile.test.ts`（既存に追記）

**Interfaces:**
- Consumes: migration 0030 の `user_settings.experience_years`・`doctor_departments`
- Produces: `getUserProfile(admin, userId): Promise<{ occupation: string|null; experienceYears: string|null; doctorDepartments: string[] }>` / `saveUserProfile(admin, userId, profile): Promise<void>`

**列が無くても落ちない作りを保つ。** 既存の `isMissingOccupationColumnError` と同じ考え方を、新しい2列にも広げる（0030 を流す前でも登録フローが 500 で袋小路にならない）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/account-profile.test.ts の末尾に追記
describe('経験年数・診療科', () => {
  it('固定リストの値だけを受ける', async () => {
    const calls: Record<string, unknown>[] = []
    const admin = { from: () => ({ upsert: async (v: Record<string, unknown>) => { calls.push(v); return { error: null } } }) }
    await saveUserProfile(admin as never, 'u1', { occupation: '医師', experienceYears: '4〜6年目', doctorDepartments: ['救急科'] })
    expect(calls[0]).toMatchObject({ occupation: '医師', experience_years: '4〜6年目', doctor_departments: ['救急科'] })
  })

  it('固定リストに無い値は落として保存する', async () => {
    const calls: Record<string, unknown>[] = []
    const admin = { from: () => ({ upsert: async (v: Record<string, unknown>) => { calls.push(v); return { error: null } } }) }
    await saveUserProfile(admin as never, 'u1', { occupation: '医師', experienceYears: '謎', doctorDepartments: ['謎科'] })
    expect(calls[0]).toMatchObject({ experience_years: null, doctor_departments: [] })
  })

  it('列が無い環境（0030 未適用）でも例外にしない', async () => {
    const admin = { from: () => ({ upsert: async () => ({ error: { code: 'PGRST204', message: "column 'experience_years' does not exist" } }) }) }
    await expect(saveUserProfile(admin as never, 'u1', { occupation: '医師', experienceYears: '1年目', doctorDepartments: [] })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/account-profile.test.ts`
Expected: FAIL（`saveUserProfile` が無い）

- [ ] **Step 3: 実装する**

`account-profile.ts` に `getUserProfile` と `saveUserProfile` を足す。値の検証は `CQ_EXPERIENCE_YEARS`・`CQ_DOCTOR_DEPARTMENTS`（`cq-submit.ts` の既存の固定リスト）を使う。列が無いことによる失敗は `isMissingOccupationColumnError` を一般化した判定で握りつぶす（判定関数の名前も `isMissingProfileColumnError` に改める）。

`CqCapture` は、端末の記憶（`CQ_PROFILE_KEY`）より**アカウントの値を優先**して初期値にする。端末を変えても入れ直しにならないのがこの修正の目的。

- [ ] **Step 4: /admin に属性別集計を足す**

`cq_submissions`（migration 0019）に投稿ごとの職種・経験年数・診療科が残っている。/admin に「投稿者の内訳」を1つ足し、職種別・経験年数別の件数を出す。**公開面には出さない**（既存の方針どおり /admin 専用）。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/account-profile.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS、型エラー0、ビルド成功

```bash
git add src/lib/account-profile.ts src/components/CqCapture.tsx src/app/admin src/lib/__tests__/account-profile.test.ts
git commit -m "feat(ask-shelf): 経験年数・診療科をアカウントに保存し、/admin に投稿者の内訳を足す"
```

---

## Task 17: ヘルプの1節と、完了条件の2つの数を /admin に出す

**Files:**
- Modify: 設定画面のヘルプ（`grep -rn "よくある質問\|ヘルプ" src/app src/components` で場所を特定する）
- Create: `src/lib/ask-shelf/metrics.ts`
- Modify: `src/app/admin/AskShelfAdminPanel.tsx`（Task 10 で作ったパネルに数を足す）
- Test: `src/lib/__tests__/ask-shelf-metrics.test.ts`

**Interfaces:**
- Consumes: `ask_shelf_queries` の行、受付DBの一覧
- Produces: `notSentRate(rows: { submitted: boolean }[]): { shown: number; notSent: number; rate: number }` / `resubmitAfterDecline(pages, now): number`

**ヘルプに書く1節**（設計書「棚に無ければ答えない、を仕様として書く」）

> **MediNodeが答えないとき**
> MediNodeは、検証済みの主張が棚にあるときだけ答えます。棚に無ければ「MediNodeにはこの問いの検証済みの主張はまだありません」と表示し、AIに文章を作らせることはしません。無いものを無いと言うほうが、それらしい文を出すより安全だと考えているためです。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/ask-shelf-metrics.test.ts
import { describe, it, expect } from 'vitest'
import { notSentRate, resubmitAfterDecline } from '@/lib/ask-shelf/metrics'

describe('notSentRate（段0を見せた後に送らずに済んだ割合）', () => {
  it('送らなかった割合を出す', () => {
    expect(notSentRate([{ submitted: false }, { submitted: false }, { submitted: true }]))
      .toEqual({ shown: 3, notSent: 2, rate: 2 / 3 })
  })
  it('1件も無ければ割合は0（0除算にしない）', () => {
    expect(notSentRate([])).toEqual({ shown: 0, notSent: 0, rate: 0 })
  })
})

describe('resubmitAfterDecline（記事化しないを見た後の再投稿）', () => {
  const rich = (v: string) => ({ rich_text: [{ plain_text: v }] })
  const page = (userId: string, status: string, created: string) => ({
    id: created, created_time: created,
    properties: { 通知先ユーザーID: rich(userId), 対応状態: { select: status ? { name: status } : null } },
  } as never)

  it('対応不要になった人が30日以内に出し直した件数を数える', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u1', '', '2026-08-10T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(1)
  })
  it('30日を過ぎた出し直しは数えない', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u1', '', '2026-09-04T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(0)
  })
  it('別の人の投稿は数えない', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u2', '', '2026-08-10T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(0)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/ask-shelf-metrics.test.ts`
Expected: FAIL（`@/lib/ask-shelf/metrics` が無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/ask-shelf/metrics.ts
// 完了条件の2つの数（更新案H）。どちらも /admin にだけ出す。
// 「段0が効いているか」を印象でなく数で見るための最小の道具で、点数や順位は作らない。
import type { NotionIntakePage } from '../cq-board'

export function notSentRate(rows: { submitted: boolean }[]): { shown: number; notSent: number; rate: number } {
  const shown = rows.length
  const notSent = rows.filter((r) => !r.submitted).length
  return { shown, notSent, rate: shown === 0 ? 0 : notSent / shown }
}

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function ownerOf(p: NotionIntakePage): string {
  const arr = (p.properties?.['通知先ユーザーID'] as { rich_text?: Array<{ plain_text?: unknown }> } | undefined)?.rich_text
  return Array.isArray(arr) ? arr.map((t) => String(t?.plain_text ?? '')).join('').trim() : ''
}
function statusOf(p: NotionIntakePage): string {
  const sel = (p.properties?.['対応状態'] as { select?: { name?: unknown } | null } | undefined)?.select
  return sel?.name ? String(sel.name) : ''
}

// 「今回は記事化しません」を見たあとに、同じ人が出し直したか。
// 出口を見せたことで投稿が止まってしまうなら、文言か理由の見せ方を直す合図になる。
export function resubmitAfterDecline(pages: NotionIntakePage[], now: Date): number {
  const declinedAt = new Map<string, number>()
  for (const p of pages) {
    if (statusOf(p) !== '対応不要') continue
    const u = ownerOf(p)
    const t = Date.parse(p.created_time || '')
    if (!u || !Number.isFinite(t)) continue
    // 同じ人に複数あるときは、いちばん新しい見送りを基点にする。
    declinedAt.set(u, Math.max(declinedAt.get(u) ?? 0, t))
  }
  let n = 0
  for (const p of pages) {
    if (statusOf(p) === '対応不要') continue
    const u = ownerOf(p)
    const base = declinedAt.get(u)
    const t = Date.parse(p.created_time || '')
    if (!u || base === undefined || !Number.isFinite(t)) continue
    if (t > base && t - base <= WINDOW_MS && t <= now.getTime()) n++
  }
  return n
}
```

- [ ] **Step 4: /admin に出し、ヘルプに1節を足す**

Task 10 のパネルの先頭に2行を出す。「段0を見せた回 n 件のうち、送らずに済んだのは m 件（x%）」と「記事化しないのあと30日以内の再投稿 k 件」。点数・順位・赤い表示は作らない。

ヘルプは上の文をそのまま置く。

- [ ] **Step 5: 通ることを確かめてコミット**

Run: `npx vitest run src/lib/__tests__/ask-shelf-metrics.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS（5件）、型エラー0、ビルド成功

```bash
git add src/lib/ask-shelf/metrics.ts src/app/admin src/lib/__tests__/ask-shelf-metrics.test.ts
git commit -m "feat(ask-shelf): 完了条件の2つの数を /admin に出し、ヘルプに「棚に無ければ答えない」を書く"
```

---

## 最後に（実装が終わったあと）

- [ ] 全体のテストを通す: `npx vitest run --dir src`（リポジトリ直下の `npm test` は worktree の同名テストを重複して拾う）
- [ ] 本番ビルド: `npm run build`
- [ ] **公開リポの走査**: `git diff main...HEAD` を開き、事業数値・有料の主張本文・患者情報が混ざっていないか目で見る
- [ ] `superpowers:requesting-code-review` でレビューを受ける
- [ ] **push はオーナーの承認を取ってから**

## オーナーの作業（Claude が代行しない）

| いつ | 何を |
|---|---|
| Task 10 の前 | 受付DBに列を4つ足す（段0結果 select／段0主張ID rich_text／正本主張ID rich_text／見送りの理由 select・選択肢5つ） |
| デプロイの前 | migration 0030 を Supabase の SQL Editor で流し、README の表に印を付ける |
| デプロイの前 | `ASK_SHELF_EMAILS` に自分のメールを入れる（`.env.local` と Vercel） |
| 任意 | Supabase の Extensions で pgroonga を有効にし、0031 を流す（無くても動く） |
| 実装後 | 完了条件の6つを本番で1周する |

## 完了条件（設計書と同じ。実装が終わっただけでは閉じない）

1. 疑問を書いて段0が主張を返す、または「MediNodeにはこの問いの検証済みの主張はまだありません」が出る
2. 依頼を送る（注意5点が見えている・掲載名の希望が板に反映される）
3. 制作工程で正本化し、/admin で正本の主張を結ぶ
4. サブスク同期のあと、メールとプッシュが届き、着地画面から該当節へ飛べる
5. 球に「残した」で灯り、期限は初回閲覧から始まる
6. 「対応不要＋理由」にした依頼が、依頼者の画面で「今回は記事化しません」＋理由になる

数で見る2つ: 段0を見せた後に送らずに済んだ割合（`ask_shelf_queries` の `submitted=false` の割合）／「記事化しない」を見た依頼者が30日以内に再投稿した件数
