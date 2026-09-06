// 段1の語彙検査を、本番の主張の写しで回帰させる。自作データ同士の比較にしない。
// 固定資産は .preview/ask-shelf-fixture.json（有料本文を含むため公開リポにコミットしない）。
// 無い端末ではスキップする。作り直しは `node scripts/ask-shelf-fixture.mjs`。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { stage1InputText, unknownTerms, verifyStage1 } from '@/lib/ask-shelf/stage1-verify'

const PATH = '.preview/ask-shelf-fixture.json'
const has = fs.existsSync(PATH)
// has=false でも describe の factory は実行されるので、フォールバックを置いて
// スイート全体の実行エラーにしない(coverage-corpus と同じ理由)。
const d = has ? JSON.parse(fs.readFileSync(PATH, 'utf8')) : { claims: [] }

type Fx = { claimId: string; pageTitle: string; sectionHeading: string; body: string }
const asClaim = (c: Fx) => ({ body: c.body, source: '', sectionHeading: c.sectionHeading, pageTitle: c.pageTitle })

describe.skipIf(!has)('段1の語彙検査(本番の主張の写しで回帰)', () => {
  const all: Fx[] = d.claims
  const inputText = stage1InputText('', all.map(asClaim))

  it('実データの主張に現れるカタカナ語は、1つも未知語にならない', () => {
    const terms = [...new Set(inputText.match(/[ァ-ヺー]{4,}/g) ?? [])]
    expect(terms.length).toBeGreaterThan(0)
    const flagged = terms.filter((t) => unknownTerms(t, inputText).length > 0)
    expect(flagged).toEqual([])
  })

  it('実データに現れない語は未知語になる', () => {
    const fake = 'ゼツメイリンゲル'
    expect(inputText.includes(fake)).toBe(false)
    expect(unknownTerms(fake, inputText)).toEqual([fake.toLowerCase()])
  })

  it('実データの主張5件で、正しい形の出力が ok になる', () => {
    const five = all.slice(0, 5)
    expect(five.length).toBe(5)
    const text = stage1InputText('この問いの例', five.map(asClaim))
    const out = {
      groups: [{ heading: 'まず読む', claimIds: five.slice(0, 2).map((c) => c.claimId) },
               { heading: 'つぎに読む', claimIds: five.slice(2).map((c) => c.claimId) }],
      notCovered: [],
    }
    expect(verifyStage1(out, five.map((c) => c.claimId), text)).toBe('ok')
  })

  it('実データの節見出しをそのまま見出しに使うと、番号の数字で落ちる', () => {
    // 節見出しは「1. …」の形なので、そのままでは通らない。
    // 数字の検査が実データで効いていることの確認であって、不具合ではない。
    const numbered = all.find((c) => /^[0-9０-９]/.test(c.sectionHeading))
    expect(numbered).toBeDefined()
    const five = all.slice(0, 5)
    const text = stage1InputText('', five.map(asClaim))
    const out = { groups: [{ heading: numbered!.sectionHeading.slice(0, 20), claimIds: five.map((c) => c.claimId) }], notCovered: [] }
    expect(verifyStage1(out, five.map((c) => c.claimId), text)).toBe('rejected_vocab')
  })
})
