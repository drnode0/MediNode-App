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
