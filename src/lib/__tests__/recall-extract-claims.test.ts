import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { extractClaims, claimIdOf, normalizeBody } from '@/lib/recall/extract-claims'

const li = (text: string, children?: unknown[]) => ({
  type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: text }] }, ...(children ? { children } : {}),
})
const h2 = (text: string) => ({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }] } })
const callout = (children: unknown[]) => ({ type: 'callout', callout: { rich_text: [{ plain_text: '⚡ 結論' }] }, children })
const base = { pageId: 'p1', pageTitle: '💡 テスト', pageKind: '💡', genres: ['05.循環'] }

describe('extractClaims', () => {
  it('確信度マーク行を主張にし、本文と出典に分け、✅→ok ⚠️→caut、❓は除外', () => {
    const out = extractClaims({ ...base, blocks: [
      h2('1. 定義'),
      li('低血圧はショックの要件ではない。✅ ESICM 合意 2014'),
      li('乳酸値は施設で扱いが違う。⚠️ 施設差あり'),
      li('この点は不明確である。❓'),
    ] })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ body: '低血圧はショックの要件ではない。', source: '✅ ESICM 合意 2014', confidence: 'ok', sectionKey: 'sec1', sectionHeading: '1. 定義', primaryGenre: '05.循環', genreSlot: 4 })
    expect(out[1].confidence).toBe('caut')
  })
  it('Essentials 形式（句点のあと短い出典）を essentials として拾い、普通の文は拾わない', () => {
    const out = extractClaims({ ...base, blocks: [
      li('酸素化の目標は SpO2 92〜96% とする。BTS 2017'),
      li('この節では呼吸不全の定義を扱う。'),
    ] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ body: '酸素化の目標は SpO2 92〜96% とする。', source: 'BTS 2017', confidence: 'essentials' })
  })
  it('callout の中（結論ボックス・署名）は拾わない。入れ子の箇条書きは拾う', () => {
    const out = extractClaims({ ...base, blocks: [
      callout([li('結論の要約。✅ 出典')]),
      li('親の主張。✅ 出典A', [li('子の主張。✅ 出典B')]),
    ] })
    expect(out.map((c) => c.body)).toEqual(['親の主張。', '子の主張。'])
  })
  it('ID はページIDと正規化本文から決まり、空白・選択子の揺れで変わらない', () => {
    expect(claimIdOf('p1', '低血圧は  要件ではない。')).toBe(claimIdOf('p1', '低血圧は 要件ではない。'))
    expect(claimIdOf('p1', 'a')).not.toBe(claimIdOf('p2', 'a'))
    expect(normalizeBody('⚠️')).toBe('⚠')
  })
  it('INBOX しかないページは主張を返さない', () => {
    expect(extractClaims({ ...base, genres: ['INBOX'], blocks: [li('x。✅ y')] })).toEqual([])
  })
})

// 実データ（gitignore 済み）。無ければ skip。
const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('extractClaims 実コーパス', () => {
  it('27ページから ✅⚠️ と Essentials の主張が 680〜700 件(❓9件を除いた基準 691 の±1.5%)', () => {
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    expect(all.length).toBeGreaterThanOrEqual(680)
    expect(all.length).toBeLessThanOrEqual(700)
    expect(all.filter((c) => c.confidence === 'essentials').length).toBeGreaterThanOrEqual(80)
    expect(new Set(all.map((c) => c.claimId)).size).toBe(all.length)
  })
})
