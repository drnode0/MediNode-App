import { describe, expect, it } from 'vitest'
import {
  PX_PER_LEAF, SCENE_TOP_PAD, GROUND_GAP, SCENE_BOTTOM_PAD, MIN_MARK_GAP,
  sceneHeightPx, leafY, groundY, visibleRange, markPositions, sceneMarks,
  splitByJoin, dormantIds, RHIZOME_DEPTH,
} from '../vine-scroll'
import type { Step } from '../tower-steps'

const st = (id: string, at: string, kind: Step['kind'] = 'wrote'): Step =>
  ({ id, kind, at, genre: '', title: '' })

describe('葉の縦位置', () => {
  it('いちばん新しい葉が上端の余白の位置に来る', () => {
    expect(leafY(100, 100)).toBe(SCENE_TOP_PAD)
  })
  it('古い葉ほど下に来る（1葉あたり14px）', () => {
    expect(leafY(99, 100)).toBe(SCENE_TOP_PAD + PX_PER_LEAF)
    expect(leafY(1, 100)).toBe(SCENE_TOP_PAD + 99 * PX_PER_LEAF)
  })
  it('葉が何枚あっても間隔は縮まない（間引かない設計の担保）', () => {
    for (const total of [10, 300, 3000]) {
      expect(leafY(1, total) - leafY(2, total)).toBe(PX_PER_LEAF)
    }
  })
  it('葉0でも落ちない', () => {
    expect(() => sceneHeightPx(0)).not.toThrow()
    expect(groundY(0)).toBe(SCENE_TOP_PAD + GROUND_GAP)
  })
})

describe('シーンの丈', () => {
  it('地面は最古の葉より下、シーンはさらに下に余白を持つ', () => {
    expect(groundY(100)).toBe(leafY(1, 100) + GROUND_GAP)
    expect(sceneHeightPx(100)).toBe(groundY(100) + SCENE_BOTTOM_PAD)
  })
  it('葉300枚で6画面分ほどになる（画面700px想定）', () => {
    expect(Math.round(sceneHeightPx(300) / 700)).toBe(6)
  })
})

describe('仮想化の窓', () => {
  it('上端では新しい側だけを返す', () => {
    const r = visibleRange(0, 700, 300)
    expect(r.to).toBe(300)
    expect(r.from).toBeLessThan(300)
    expect(r.from).toBeGreaterThanOrEqual(1)
  })
  it('前後1画面分の余白を含む（窓はおよそ3画面分）', () => {
    // 上端でも下端でもない位置。3画面分 ÷ 14px = およそ150枚が窓に入る
    const mid = visibleRange(1400, 700, 300)
    expect(mid.to - mid.from + 1).toBeGreaterThanOrEqual(148)
    expect(mid.to - mid.from + 1).toBeLessThanOrEqual(156)
    // 画面の中に居る葉が窓から漏れていないこと
    expect(leafY(mid.to, 300)).toBeLessThanOrEqual(1400)
    expect(leafY(mid.from, 300)).toBeGreaterThanOrEqual(1400 + 700)
  })
  it('総数を超えない・1を下回らない', () => {
    const r = visibleRange(-9999, 700, 50)
    expect(r.from).toBe(1)
    expect(r.to).toBe(50)
  })
  it('極端に大きいスクロール位置でも窓が潰れない', () => {
    const r = visibleRange(100000, 700, 50)
    expect(r.from).toBe(1)
    expect(r.to).toBe(50)
  })
  it('葉0なら空の窓を返す', () => {
    expect(visibleRange(0, 700, 0)).toEqual({ from: 1, to: 0 })
  })
})

describe('越えた印', () => {
  it('越えた実物だけを、越えた時点の葉の位置に置く', () => {
    const marks = markPositions(60) // アリ3・テントウムシ4・ドングリ10・カタツムリ18・湯のみ35・スズメ50
    expect(marks.map((m) => m.milestone.label)).toEqual(
      ['アリ', 'テントウムシ', 'ドングリ', 'カタツムリ', '湯のみ', 'スズメ'],
    )
    const suzume = marks[marks.length - 1]
    expect(suzume.leafIndex).toBe(50)
    expect(suzume.y).toBe(leafY(50, 60))
  })
  it('まだ越えていない実物は含めない', () => {
    expect(markPositions(2)).toEqual([])
  })
})

describe('地下の深さ', () => {
  it('地下があるときだけ、その深さぶんシーンが下へ伸びる', () => {
    expect(sceneHeightPx(100, RHIZOME_DEPTH)).toBe(sceneHeightPx(100) + RHIZOME_DEPTH)
    expect(sceneHeightPx(100, 0)).toBe(sceneHeightPx(100))
  })
  it('地下ぶん深くスクロールしても窓は地面ぎわの葉を保持する', () => {
    const deep = sceneHeightPx(50, RHIZOME_DEPTH) - 700
    const r = visibleRange(deep, 700, 50, RHIZOME_DEPTH)
    expect(r.from).toBe(1)
  })
})

describe('地下茎と地上部の分割（§7）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  it('利用開始日より前の日付の歩は地下、それ以降が地上', () => {
    const r = splitByJoin([st('a', '2026-07-01T00:00:00.000Z'), st('b', '2026-08-02T00:00:00.000Z')], joined)
    expect(r.underground.map((s) => s.id)).toEqual(['a'])
    expect(r.above.map((s) => s.id)).toEqual(['b'])
  })
  it('joinedIsoが空なら分割しない（全部地上＝旧データ・devハーネス互換）', () => {
    const steps = [st('a', '2026-07-01T00:00:00.000Z')]
    expect(splitByJoin(steps, '')).toEqual({ underground: [], above: steps })
  })
  it('オフセット付きISO（Notion由来）と toISOString が混在しても日付で分ける', () => {
    const r = splitByJoin([
      st('n', '2026-07-31T23:00:00.000+09:00'), // = 7/31 14:00Z → 地下
      st('m', '2026-08-01T09:30:00.000+09:00'), // = 8/1 00:30Z → 地上
    ], joined)
    expect(r.underground.map((s) => s.id)).toEqual(['n'])
    expect(r.above.map((s) => s.id)).toEqual(['m'])
  })
  it('解釈できない日付は地上へ倒す（見えなくなる側に倒さない）', () => {
    expect(splitByJoin([st('x', 'garbage')], joined).above).toHaveLength(1)
  })
})

describe('まだ芽を出していない知識（dormantIds）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  it('地下にあり、地上にどのkindの歩も無いidだけを返す', () => {
    const steps = [
      st('a', '2026-07-01T00:00:00.000Z'), st('b', '2026-07-02T00:00:00.000Z'),
      st('a', '2026-08-02T00:00:00.000Z', 'read'), // aは芽を出した
    ]
    expect(dormantIds(steps, joined)).toEqual(['b'])
  })
  it('地下が無ければ空', () => {
    expect(dormantIds([st('a', '2026-08-02T00:00:00.000Z')], joined)).toEqual([])
  })
})

describe('シーン描画用の間引き（根元の密集対策）', () => {
  it('葉200枚のとき、間引いた印どうしのyの差はすべてMIN_MARK_GAP以上になる', () => {
    const marks = sceneMarks(200)
    for (let i = 1; i < marks.length; i++) {
      expect(Math.abs(marks[i].y - marks[i - 1].y)).toBeGreaterThanOrEqual(MIN_MARK_GAP)
    }
  })
  it('目次（markPositions）は間引かれず全件（8件）残る', () => {
    expect(markPositions(200).length).toBe(8)
  })
  it('密集した組では古いほう（アリ）が落ち、新しいほう（テントウムシ）が残る', () => {
    const marks = sceneMarks(200)
    const labels = marks.map((m) => m.milestone.label)
    expect(labels).not.toContain('アリ')
    expect(labels).toContain('テントウムシ')
  })
})
