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
