// 伏せ字の範囲は jsonb から来る（DB に検査制約が無く、管理画面では人が手で直す）。
// 壊れた範囲をそのまま slice すると、読者の目には「文字が二重に出た主張」「答えの無い穴」
// として届く。医学の主張が崩れて見えるのが最悪なので、ここは実物の値の形で固定しておく。
import { describe, it, expect } from 'vitest'
import { normalizeHoles, segmentBody } from '@/lib/recall/segments'

const BODY = '目標は 65 mmHg 以上、乳酸は 2 mmol/L 未満に保つ'
const join = (body: string, holes: unknown) => segmentBody(body, holes).map((s) => s.text).join('')
const blanks = (body: string, holes: unknown) => segmentBody(body, holes).filter((s) => s.blank).map((s) => s.text)

describe('normalizeHoles', () => {
  it('正しい範囲はそのまま、前から順に並べ直す', () => {
    expect(normalizeHoles(50, [[10, 12], [2, 4]])).toEqual([[2, 4], [10, 12]])
  })

  it('逆順の対（[12,10]）は入れ替えず捨てる', () => {
    expect(normalizeHoles(50, [[12, 10]])).toEqual([])
    expect(normalizeHoles(50, [[12, 10], [2, 4]])).toEqual([[2, 4]])
  })

  it('重なった範囲は1つに畳む', () => {
    expect(normalizeHoles(50, [[2, 8], [5, 12]])).toEqual([[2, 12]])
    expect(normalizeHoles(50, [[2, 5], [5, 9]])).toEqual([[2, 9]]) // 接しているだけの範囲も畳む
  })

  it('完全に内側に収まる範囲は、外側1つに吸収され別々には出ない', () => {
    expect(normalizeHoles(50, [[2, 12], [5, 8]])).toEqual([[2, 12]])
  })

  it('本文の外は本文の長さに丸め、丸めて幅が無くなったものは捨てる', () => {
    expect(normalizeHoles(10, [[8, 99]])).toEqual([[8, 10]])
    expect(normalizeHoles(10, [[20, 30]])).toEqual([])
  })

  it('負の数は 0 に丸める（末尾から切り出させない）', () => {
    expect(normalizeHoles(10, [[-5, 3]])).toEqual([[0, 3]])
    expect(normalizeHoles(10, [[-9, -2]])).toEqual([])
  })

  it('幅ゼロの範囲は捨てる', () => {
    expect(normalizeHoles(10, [[3, 3]])).toEqual([])
  })

  it('数の対でないものは捨てる', () => {
    expect(normalizeHoles(10, [[1, 2, 3], [4], ['1', '5'], [NaN, 5], [1, Infinity], [1.5, 4], null, 7, {}, [2, 5]]))
      .toEqual([[2, 5]])
  })

  it('配列でない holes でも落ちない', () => {
    expect(normalizeHoles(10, null)).toEqual([])
    expect(normalizeHoles(10, undefined)).toEqual([])
    expect(normalizeHoles(10, { a: 1 })).toEqual([])
    expect(normalizeHoles(10, 'x')).toEqual([])
  })
})

describe('segmentBody', () => {
  it('段の text をつなぐと本文に戻る（どんな範囲が来ても）', () => {
    const cases: unknown[] = [
      [[3, 6]],
      [[10, 12], [2, 4]],       // 並びが逆
      [[2, 8], [5, 12]],        // 重なり
      [[12, 10]],               // 対が逆順
      [[-4, 6]],                // 負
      [[100, 200]],             // 本文の外
      [[0, BODY.length]],       // 全部が伏せ字
      [],
      null,
      'こわれた値',
      [[1, 2, 3]],
    ]
    for (const holes of cases) expect(join(BODY, holes), `holes=${JSON.stringify(holes)}`).toBe(BODY)
  })

  it('伏せ字の段は、どんな範囲が来ても空文字にならない（答えの無い穴を作らない）', () => {
    const cases: unknown[] = [
      [[3, 6]],
      [[10, 12], [2, 4]],
      [[2, 8], [5, 12]],
      [[2, 12], [5, 8]],       // 内側に完全に収まる範囲
      [[12, 10]],
      [[-4, 6]],
      [[100, 200]],
      [[0, BODY.length]],
      [],
      null,
      'こわれた値',
      [[1, 2, 3]],
    ]
    for (const holes of cases) {
      for (const s of segmentBody(BODY, holes)) {
        if (s.blank) expect(s.text.length, `holes=${JSON.stringify(holes)}`).toBeGreaterThan(0)
      }
    }
  })

  it('伏せ字は本文のその位置の文字そのもの', () => {
    expect(blanks(BODY, [[4, 10]])).toEqual([BODY.slice(4, 10)])
  })

  it('並びが逆でも、同じ文字を二度出さない', () => {
    const segs = segmentBody(BODY, [[10, 12], [2, 4]])
    expect(segs.map((s) => s.text).join('')).toBe(BODY)
    expect(blanks(BODY, [[10, 12], [2, 4]])).toEqual([BODY.slice(2, 4), BODY.slice(10, 12)])
  })

  it('使える範囲が無ければ伏せ字ゼロ（表示のときに穴を作らない）', () => {
    expect(segmentBody(BODY, [[12, 10]])).toEqual([{ text: BODY, blank: false }])
    expect(segmentBody(BODY, null)).toEqual([{ text: BODY, blank: false }])
  })

  it('空の本文でも落ちない', () => {
    expect(segmentBody('', [[0, 3]])).toEqual([])
  })
})
