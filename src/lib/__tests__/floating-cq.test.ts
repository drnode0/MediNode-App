import { describe, it, expect } from 'vitest'
import {
  isUnresolvedCq,
  notionPageIdOf,
  countNewAnswers,
  pickFloating,
  placeFloating,
  gridFor,
  formatCqAge,
  FLOAT_MAX,
  WIDE_GRID,
  NARROW_GRID,
  type CqSeed,
  type AnswerHit,
} from '../floating-cq'

function cq(over: Partial<CqSeed> & { objectID: string }): CqSeed {
  return {
    title: '尿道カテーテルはいつ抜く？',
    notionUrl: 'https://notion.so/x',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastEdited: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

describe('isUnresolvedCq', () => {
  it('知識レベルが「❓ CQ」なら未解決', () => {
    expect(isUnresolvedCq({ knowledgeLevel: '❓ CQ' })).toBe(true)
  })

  it('旧値「❓ クリニカルクエスチョン」も未解決として拾う', () => {
    expect(isUnresolvedCq({ knowledgeLevel: '❓ クリニカルクエスチョン' })).toBe(true)
  })

  it('ナレッジに育ったものは未解決ではない', () => {
    expect(isUnresolvedCq({ knowledgeLevel: '💡 ナレッジ' })).toBe(false)
  })

  it('知識レベルが無いものは未解決ではない（参考文献などを巻き込まない）', () => {
    expect(isUnresolvedCq({})).toBe(false)
    expect(isUnresolvedCq({ knowledgeLevel: '' })).toBe(false)
  })
})

describe('notionPageIdOf', () => {
  it('owner接頭辞を落としてNotionのページIDだけにする', () => {
    expect(notionPageIdOf('personal_22a1b2c3-d4e5-4f60-8712-3456789abcde')).toBe(
      '22a1b2c3-d4e5-4f60-8712-3456789abcde',
    )
    expect(notionPageIdOf('team_abc')).toBe('abc')
  })

  it('接頭辞が無ければそのまま返す', () => {
    expect(notionPageIdOf('abc')).toBe('abc')
  })

  it('落とすのは先頭の1回だけ（ID中の同じ並びを削らない）', () => {
    expect(notionPageIdOf('personal_personal_abc')).toBe('personal_abc')
  })
})

describe('countNewAnswers', () => {
  const hits: AnswerHit[] = [
    { objectID: 'a', createdAt: '2026-07-20T00:00:00.000Z' },
    { objectID: 'b', createdAt: '2026-06-01T00:00:00.000Z' },
    { objectID: 'c', createdAt: '2026-08-01T00:00:00.000Z' },
  ]

  it('CQの登録日より後に入ったヒットだけ数える', () => {
    expect(countNewAnswers('2026-07-01T00:00:00.000Z', hits)).toBe(2)
  })

  it('createdAtを持たないヒットは新着扱いしない', () => {
    expect(countNewAnswers('2026-07-01T00:00:00.000Z', [{ objectID: 'd' }])).toBe(0)
  })

  it('CQ側の登録日が不明なら新しい答えとして数えない（どのCQにも付くのを防ぐ）', () => {
    expect(countNewAnswers(undefined, hits)).toBe(0)
    expect(countNewAnswers('', hits)).toBe(0)
  })
})

describe('pickFloating', () => {
  it('新しい答えのあるCQを先に浮かべ、次に新しい順で並べる', () => {
    const cqs = [
      cq({ objectID: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      cq({ objectID: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      cq({ objectID: 'lit', createdAt: '2026-02-01T00:00:00.000Z' }),
    ]
    const { floating } = pickFloating(cqs, { lit: 3 })
    expect(floating.map((c) => c.objectID)).toEqual(['lit', 'new', 'old'])
  })

  it('新しい答えの多い順に並べる', () => {
    const cqs = [cq({ objectID: 'a' }), cq({ objectID: 'b' })]
    const { floating } = pickFloating(cqs, { a: 1, b: 5 })
    expect(floating.map((c) => c.objectID)).toEqual(['b', 'a'])
  })

  it('上限を超えた分は浮かべずrestに回す', () => {
    const cqs = Array.from({ length: FLOAT_MAX + 3 }, (_, i) =>
      cq({ objectID: `c${i}`, createdAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
    )
    const { floating, rest } = pickFloating(cqs, {})
    expect(floating).toHaveLength(FLOAT_MAX)
    expect(rest).toHaveLength(3)
    // restは浮かんでいる分と重複しない
    const ids = new Set(floating.map((c) => c.objectID))
    expect(rest.every((c) => !ids.has(c.objectID))).toBe(true)
  })

  it('登録日が無いものはlastEditedで並べる', () => {
    const cqs = [
      cq({ objectID: 'a', createdAt: undefined, lastEdited: '2026-01-01T00:00:00.000Z' }),
      cq({ objectID: 'b', createdAt: undefined, lastEdited: '2026-08-01T00:00:00.000Z' }),
    ]
    const { floating } = pickFloating(cqs, {})
    expect(floating.map((c) => c.objectID)).toEqual(['b', 'a'])
  })
})

describe('formatCqAge', () => {
  const now = new Date('2026-08-08T09:00:00.000Z')

  it('実日付と経過をひと続きで出す', () => {
    expect(formatCqAge('2026-03-14T00:00:00.000Z', now)).toBe('2026-03-14 に残した・4か月前')
  })

  it('30日未満は日数で出す', () => {
    expect(formatCqAge('2026-08-01T00:00:00.000Z', now)).toBe('2026-08-01 に残した・7日前')
  })

  it('当日は「今日」', () => {
    expect(formatCqAge('2026-08-08T01:00:00.000Z', now)).toBe('2026-08-08 に残した・今日')
  })

  it('1年を超えたら年で丸める', () => {
    expect(formatCqAge('2024-02-01T00:00:00.000Z', now)).toBe('2024-02-01 に残した・2年前')
  })

  it('日付が無い・壊れているときは何も出さない', () => {
    expect(formatCqAge(undefined, now)).toBe('')
    expect(formatCqAge('', now)).toBe('')
    expect(formatCqAge('not-a-date', now)).toBe('')
  })
})

describe('gridFor', () => {
  it('狭い画面は2列にする（3列だと泡が1文字ずつ折り返す）', () => {
    expect(gridFor(375)).toEqual(NARROW_GRID)
    expect(gridFor(639)).toEqual(NARROW_GRID)
  })

  it('広い画面は3列', () => {
    expect(gridFor(640)).toEqual(WIDE_GRID)
    expect(gridFor(1280)).toEqual(WIDE_GRID)
  })
})

describe('placeFloating', () => {
  it('同じ入力からは同じ配置を返す（再レンダーで泡が飛ばない）', () => {
    const cqs = [cq({ objectID: 'a' }), cq({ objectID: 'b' })]
    const first = placeFloating(cqs, {})
    const second = placeFloating(cqs, {})
    expect(first).toEqual(second)
  })

  it('泡の幅ごと枠内に収まる（端が切れない）', () => {
    for (const grid of [WIDE_GRID, NARROW_GRID]) {
      const cqs = Array.from({ length: grid.cols * grid.rows }, (_, i) => cq({ objectID: `c${i}` }))
      for (const p of placeFloating(cqs, {}, grid)) {
        expect(p.x - p.widthPercent / 2).toBeGreaterThanOrEqual(0)
        expect(p.x + p.widthPercent / 2).toBeLessThanOrEqual(100)
        // 上下は泡の高さの半分ぶん余白を残す（ヘッダーに食い込ませない）。
        expect(p.y).toBeGreaterThanOrEqual(14)
        expect(p.y).toBeLessThanOrEqual(86)
      }
    }
  })

  it('泡は横に重ならない（同じ行の隣同士が離れている）', () => {
    const cqs = Array.from({ length: 6 }, (_, i) => cq({ objectID: `c${i}` }))
    const placed = placeFloating(cqs, {}, WIDE_GRID)
    const row0 = placed.slice(0, 3).sort((a, b) => a.x - b.x)
    for (let i = 1; i < row0.length; i++) {
      const gap = row0[i].x - row0[i - 1].x
      expect(gap).toBeGreaterThanOrEqual(row0[i].widthPercent)
    }
  })

  it('件数が少なくても縦を使い切る（上に寄って下半分が死なない）', () => {
    const cqs = Array.from({ length: 3 }, (_, i) => cq({ objectID: `c${i}` }))
    const placed = placeFloating(cqs, {}, WIDE_GRID)
    // 1行しか要らない件数なら、その1行は枠の中央帯に来る
    for (const p of placed) {
      expect(p.y).toBeGreaterThan(20)
      expect(p.y).toBeLessThan(80)
    }
  })

  it('区画数を超える分は置かない', () => {
    const cqs = Array.from({ length: 20 }, (_, i) => cq({ objectID: `c${i}` }))
    expect(placeFloating(cqs, {}, NARROW_GRID)).toHaveLength(NARROW_GRID.cols * NARROW_GRID.rows)
  })

  it('新しい答えのあるCQは大きく、はっきり出す', () => {
    const cqs = [cq({ objectID: 'lit' }), cq({ objectID: 'dim' })]
    const placed = placeFloating(cqs, { lit: 2 })
    const lit = placed.find((p) => p.objectID === 'lit')!
    const dim = placed.find((p) => p.objectID === 'dim')!
    expect(lit.newAnswerCount).toBe(2)
    expect(lit.size).toBe('lg')
    expect(lit.opacity).toBeGreaterThan(dim.opacity)
  })

  it('漂う速さは泡ごとにばらつく（一斉に動かない）', () => {
    const cqs = Array.from({ length: 6 }, (_, i) => cq({ objectID: `c${i}` }))
    const placed = placeFloating(cqs, {})
    expect(new Set(placed.map((p) => `${p.driftSeconds}:${p.delaySeconds}`)).size).toBeGreaterThan(1)
    for (const p of placed) {
      expect(p.driftSeconds).toBeGreaterThanOrEqual(9)
      expect(p.driftSeconds).toBeLessThanOrEqual(18)
    }
  })
})
