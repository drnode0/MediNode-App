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
  it('❓ が2番目以降のマークとして来る行（⚠️❓・✅…❓）も主張にしない', () => {
    // 旧ロジックは s.search(MARK) で最初のマークしか見ておらず、⚠️ や ✅ が先に
    // 見つかれば ❓ の存在を無視して主張化していた（実コーパスで9/10件がこの穴を通過）。
    const out = extractClaims({ ...base, blocks: [
      li('乳酸値の解釈は施設差が大きい。⚠️❓ 要確認'),
      li('この基準値は暫定的である。✅ 出典 2020 ❓ 未確定'),
    ] })
    expect(out).toHaveLength(0)
  })
  it('マークで始まる行（本文が空になる行）は主張にしない', () => {
    const out = extractClaims({ ...base, blocks: [li('✅ 出典のみで本文がない行')] })
    expect(out).toHaveLength(0)
  })
  it('claimIdOf はページIDのダッシュ有無・大文字小文字に依らず同じIDを返す', () => {
    const dashed = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'
    const undashed = dashed.replace(/-/g, '')
    expect(claimIdOf(dashed, '同じ主張。')).toBe(claimIdOf(undashed, '同じ主張。'))
    expect(claimIdOf(dashed, '同じ主張。')).toBe(claimIdOf(dashed.toUpperCase(), '同じ主張。'))
  })
  it('callout 除外は孫要素にも継承される。通常の入れ子は2段目でも拾う', () => {
    const out = extractClaims({ ...base, blocks: [
      li('親の主張。✅ 出典A', [
        li('子の主張。✅ 出典B', [
          li('孫の主張。✅ 出典C'),
        ]),
      ]),
      callout([
        li('結論直下の主張。✅ 出典D', [
          li('結論の孫。✅ 出典E'),
        ]),
      ]),
    ] })
    expect(out.map((c) => c.body)).toEqual(['親の主張。', '子の主張。', '孫の主張。'])
  })
})

// 実データ（gitignore 済み）。無ければ skip。
const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('extractClaims 実コーパス', () => {
  it('27ページから ✅⚠️ と Essentials の主張が 680〜700 件(❓を除いた基準の±1.5%)', () => {
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    expect(all.length).toBeGreaterThanOrEqual(680)
    expect(all.length).toBeLessThanOrEqual(700)
    // ❓ が混じった主張は決して出てはいけない（Fix 1 の生きた回帰テスト）
    expect(all.every((c) => !c.body.includes('❓') && !c.source.includes('❓'))).toBe(true)
    // 主張として使う以上、本文とジャンルは必ず埋まっている
    expect(all.every((c) => c.body.length > 0)).toBe(true)
    expect(all.every((c) => c.primaryGenre.length > 0)).toBe(true)
    // 確信度の内訳は実測（ok 423 / caut 178 / essentials 86, 2026-09時点）に少し幅を持たせた帯。
    // 帯を外れたら、比率が変わるようなコード変更かコーパス側の変化を疑う。
    const ok = all.filter((c) => c.confidence === 'ok').length
    const caut = all.filter((c) => c.confidence === 'caut').length
    const essentials = all.filter((c) => c.confidence === 'essentials').length
    expect(ok).toBeGreaterThanOrEqual(405)
    expect(ok).toBeLessThanOrEqual(440)
    expect(caut).toBeGreaterThanOrEqual(160)
    expect(caut).toBeLessThanOrEqual(195)
    expect(essentials).toBeGreaterThanOrEqual(78)
    expect(essentials).toBeLessThanOrEqual(95)
  })
})
