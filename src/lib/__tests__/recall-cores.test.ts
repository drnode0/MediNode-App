// 芯の族。席がどの族に属するか、族ごとの動きが混ざっていないか。
import { describe, it, expect } from 'vitest'
import { coreKindOf, coreIndividual, CORE_LABEL, CORE_SPIN, CORE_TILT, type CoreKind } from '@/lib/recall/cores'
import { GENRE_SEATS, OTHER_SLOT } from '@/lib/recall/genres'

const slotOf = (name: string) => GENRE_SEATS.findIndex((s) => s === name)

describe('席と族', () => {
  it('設計書の7族の表どおりに割り当たっている', () => {
    const expected: Record<string, CoreKind> = {
      '03.救急蘇生': 'flow', '05.循環': 'flow', '11.血液凝固線溶系': 'flow', '22.輸液・輸血・水電解質': 'flow',
      '04.呼吸': 'exchange', '07.腎': 'exchange', '23.栄養': 'exchange',
      '06.中枢神経': 'signal', '33.精神科': 'signal', '38.症候': 'signal',
      '13.感染症': 'invasion', '16.熱傷': 'invasion', '34.アレルギー・免疫': 'invasion',
      '15.外傷・整形': 'structure', '26.手技': 'structure', '36.病院前・搬送': 'structure',
      '14.多臓器障害': 'regulation', '27.薬剤': 'regulation', '37.腫瘍・血液救急': 'regulation',
      '01.総論': 'system', '25.ICU運営・医療安全・教育': 'system', '31.他科救急': 'system',
    }
    for (const [seat, kind] of Object.entries(expected)) {
      const slot = slotOf(seat)
      expect(slot, `席が見つからない: ${seat}`).toBeGreaterThanOrEqual(0)
      expect(coreKindOf(slot), seat).toBe(kind)
    }
  })

  it('37席すべてに族が付く（既定へ落ちる席が体系だけである）', () => {
    const byKind = new Map<CoreKind, string[]>()
    GENRE_SEATS.forEach((seat, slot) => {
      const k = coreKindOf(slot)
      if (!byKind.has(k)) byKind.set(k, [])
      byKind.get(k)!.push(seat)
    })
    // 7族すべてが使われている
    expect([...byKind.keys()].sort()).toEqual(
      ['exchange', 'flow', 'invasion', 'regulation', 'signal', 'structure', 'system'],
    )
    // 体系に落ちるのは、体系として決めた6席だけ（取りこぼしがここに溜まらない）
    expect(byKind.get('system')).toEqual([
      '01.総論', '02.医療倫理', '25.ICU運営・医療安全・教育', '29.学会', '30.統計・研究', '31.他科救急',
    ])
  })

  it('席の外は体系に寄せる（自分の形を持たない族なので受け皿にできる）', () => {
    expect(coreKindOf(OTHER_SLOT)).toBe('system')
    expect(coreKindOf(999)).toBe('system')
    expect(coreKindOf(-1)).toBe('system')
  })

  it('族の名前は7つそろっている', () => {
    expect(Object.keys(CORE_LABEL).length).toBe(7)
    expect(CORE_LABEL.invasion).toBe('侵入')
  })

  // 「2族が同じ動きに見えたらどちらかを変える」は形と動きを合わせた話で、
  // 自転の速さ1つで全族を分けているわけではない。交換と侵入はどちらも編んだ球で
  // 最も近く、速さ（0.1）も揃えてある。設計書はこの2族を「潰れるなら交換の内殻を
  // 小さくするか通路の光を強くする」と、形と光で分ける方針にしている。
  // ここではその事実を固定して、あとから速さを触ったときに気付けるようにする。
  it('交換と侵入は自転の速さが同じ（形と光で分ける、と決めてある）', () => {
    expect(CORE_SPIN.exchange).toBe(CORE_SPIN.invasion)
    expect(CORE_TILT.exchange).not.toBe(CORE_TILT.invasion) // 傾きは違う
  })

  it('それ以外の族は、速さも傾きも重ならない', () => {
    const kinds = (Object.keys(CORE_SPIN) as CoreKind[]).filter((k) => k !== 'invasion')
    const spins = kinds.map((k) => CORE_SPIN[k])
    expect(new Set(spins).size).toBe(spins.length)
    const tilts = Object.values(CORE_TILT)
    expect(new Set(tilts).size).toBe(tilts.length)
  })
})

describe('個体差', () => {
  it('席番号だけで決まる（同じ席なら何度呼んでも同じ）', () => {
    expect(coreIndividual(4)).toEqual(coreIndividual(4))
    expect(coreIndividual(4)).not.toEqual(coreIndividual(5))
  })

  it('大きさ・傾き・自転の速さだけ。形は変えない', () => {
    for (let slot = 0; slot < GENRE_SEATS.length; slot++) {
      const it = coreIndividual(slot)
      expect(Object.keys(it).sort()).toEqual(['rate', 'scale', 'tilt'])
      expect(it.scale).toBeGreaterThanOrEqual(0.88)
      expect(it.scale).toBeLessThanOrEqual(1.12)
      expect(Math.abs(it.tilt)).toBeLessThanOrEqual(1.1)
      expect(it.rate).toBeGreaterThanOrEqual(0.7)
      expect(it.rate).toBeLessThanOrEqual(1.3)
    }
  })

  it('席を末尾に足しても、既存の席の個体差は動かない', () => {
    // 個体差は席番号だけの関数なので、配列が伸びても前の席の値は変わらない。
    const before = GENRE_SEATS.map((_, slot) => coreIndividual(slot))
    const after = [...GENRE_SEATS, '39.新しい席'].map((_, slot) => coreIndividual(slot))
    expect(after.slice(0, before.length)).toEqual(before)
  })
})
