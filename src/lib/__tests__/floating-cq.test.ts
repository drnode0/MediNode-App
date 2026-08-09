import { describe, it, expect } from 'vitest'
import {
  isUnresolvedCq,
  countNewAnswers,
  mergeAnswerCounts,
  pickFloating,
  placeFloating,
  gridFor,
  skyHeight,
  usedRowsFor,
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

describe('mergeAnswerCounts', () => {
  it('両方の棚から見つかった分を足す', () => {
    expect(mergeAnswerCounts({ a: 2 }, { a: 3 })).toEqual({ a: 5 })
  })

  it('片方にしか無いものはそのまま残す', () => {
    expect(mergeAnswerCounts({ a: 1 }, { b: 4 })).toEqual({ a: 1, b: 4 })
  })

  it('元の値を書き換えない', () => {
    const own = { a: 1 }
    mergeAnswerCounts(own, { a: 2 })
    expect(own).toEqual({ a: 1 })
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

describe('skyHeight / usedRowsFor', () => {
  it('件数が少なければ行も減る', () => {
    expect(usedRowsFor(1, WIDE_GRID)).toBe(1)
    expect(usedRowsFor(4, WIDE_GRID)).toBe(2)
    expect(usedRowsFor(12, WIDE_GRID)).toBe(4)
  })

  it('区画数を超えても行は増えない', () => {
    expect(usedRowsFor(100, WIDE_GRID)).toBe(WIDE_GRID.rows)
  })

  it('空の高さは行数で伸びる（4件のときに真ん中が抜けない）', () => {
    expect(skyHeight(4, WIDE_GRID)).toBe('min(290px, 66vh)')
    expect(skyHeight(12, WIDE_GRID)).toBe('min(550px, 66vh)')
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
      const cqs = Array.from({ length: grid.cols * grid.rows }, (_, i) =>
        cq({ objectID: `c${i}`, title: 'あ'.repeat(4 + i * 6) }),
      )
      for (const p of placeFloating(cqs, {}, grid)) {
        expect(p.x - p.widthPercent / 2).toBeGreaterThanOrEqual(0)
        expect(p.x + p.widthPercent / 2).toBeLessThanOrEqual(100)
        // 上下は泡の高さの半分ぶん余白を残す（ヘッダーに食い込ませない）。
        expect(p.y).toBeGreaterThanOrEqual(14)
        expect(p.y).toBeLessThanOrEqual(86)
      }
    }
  })

  it('泡は横に重ならない（幅が違っても隣とぶつからない）', () => {
    const cqs = [
      cq({ objectID: 'a', title: '短い問い' }),
      cq({ objectID: 'b', title: '中くらいの長さの問いはどう扱うか？' }),
      cq({ objectID: 'c', title: '低ナトリウム血症の補正速度はなぜ・どこまで制限するか？（浸透圧性脱髄症候群の予防）' }),
    ]
    const row0 = placeFloating(cqs, {}, WIDE_GRID).sort((a, b) => a.x - b.x)
    for (let i = 1; i < row0.length; i++) {
      const gap = row0[i].x - row0[i - 1].x
      expect(gap).toBeGreaterThanOrEqual((row0[i].widthPercent + row0[i - 1].widthPercent) / 2)
    }
  })

  it('足し幅を渡すと横を広く取る（ハートの分など）。ただし区画は超えない', () => {
    const short = cq({ objectID: 'a', title: '短い問い' })
    const long = cq({ objectID: 'b', title: 'あ'.repeat(60) })
    const [plainShort] = placeFloating([short], {}, WIDE_GRID)
    const [boostedShort] = placeFloating([short], {}, WIDE_GRID, 0.1)
    expect(boostedShort.widthPercent).toBeGreaterThan(plainShort.widthPercent)

    const [plainLong] = placeFloating([long], {}, WIDE_GRID)
    const [boostedLong] = placeFloating([long], {}, WIDE_GRID, 0.1)
    expect(boostedLong.widthPercent).toBe(plainLong.widthPercent)
  })

  it('題が短い泡は小さく、長い泡は大きい（潰れず、間延びもしない）', () => {
    const [short, mid, long] = placeFloating(
      [
        cq({ objectID: 'a', title: '短い問い' }),
        cq({ objectID: 'b', title: '中くらいの長さの問いはどう扱うか？' }),
        cq({ objectID: 'c', title: '低ナトリウム血症の補正速度はなぜ・どこまで制限するか？（浸透圧性脱髄症候群の予防）' }),
      ],
      {},
      WIDE_GRID,
    )
    expect(short.widthPercent).toBeLessThan(mid.widthPercent)
    expect(mid.widthPercent).toBeLessThan(long.widthPercent)
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

  it('漂う軌道と傾きは泡ごとに違う（全部が同じ振れ方をしない）', () => {
    const cqs = Array.from({ length: 8 }, (_, i) => cq({ objectID: `c${i}` }))
    const placed = placeFloating(cqs, {})
    const paths = new Set(
      placed.map((p) => `${p.driftX}:${p.driftY}:${p.driftX2}:${p.driftY2}:${p.tiltDeg}`),
    )
    expect(paths.size).toBeGreaterThan(1)
  })

  it('揺れ幅は控えめに収める（隣の区画へはみ出させない）', () => {
    const cqs = Array.from({ length: 12 }, (_, i) => cq({ objectID: `c${i}` }))
    for (const p of placeFloating(cqs, {})) {
      for (const px of [p.driftX, p.driftY, p.driftX2, p.driftY2]) {
        expect(px).toBeGreaterThan(0)
        expect(px).toBeLessThanOrEqual(16)
      }
      expect(p.tiltDeg).toBeGreaterThan(0)
      expect(p.tiltDeg).toBeLessThanOrEqual(2.2)
    }
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
