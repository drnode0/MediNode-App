import { describe, expect, it } from 'vitest'
import {
  MM_PER_LEAF, COMPOUND_START_LEAVES, COMPOUND_RATE,
  heightMmFromLeaves, leavesForHeightMm, formatHeight,
  LADDER, FAR_DREAM, nextMilestone, passedMilestones, sceneForLeaves,
} from '../vine-ladder'

describe('ゴールデン定数（GA後は変更不可。落ちたら定数を疑え、テストを直すな）', () => {
  it('葉1枚=2mm・複利開始200枚・r=0.5%', () => {
    expect(MM_PER_LEAF).toBe(2)
    expect(COMPOUND_START_LEAVES).toBe(200)
    expect(COMPOUND_RATE).toBe(0.005)
  })
  // 複利帯の1枚あたりの伸びは (START×MM_PER_LEAF)×RATE。これが MM_PER_LEAF と
  // 等しくなる条件が START×RATE=1。崩すと複利開始と同時に減速する。
  it('不変条件: 複利開始枚数 × 率 = 1（境界が滑らかにつながる条件）', () => {
    expect(COMPOUND_START_LEAVES * COMPOUND_RATE).toBe(1)
  })
  it('実寸帯: 葉0=0mm・葉3=6mm・葉200=400mm', () => {
    expect(heightMmFromLeaves(0)).toBe(0)
    expect(heightMmFromLeaves(3)).toBe(6)
    expect(heightMmFromLeaves(200)).toBe(400)
  })
  it('複利帯: 葉201=402mm・富士山(3776m)は葉2036枚で越える', () => {
    expect(heightMmFromLeaves(201)).toBeCloseTo(402, 6)
    expect(leavesForHeightMm(3_776_000)).toBe(2036)
  })
  it('境界の伸びが2mmのまま連続する', () => {
    expect(heightMmFromLeaves(201) - heightMmFromLeaves(200)).toBeCloseTo(2, 6)
  })
})

describe('heightMmFromLeaves', () => {
  it('単調増加（0〜2000枚）', () => {
    let prev = -1
    for (let n = 0; n <= 2000; n++) {
      const h = heightMmFromLeaves(n)
      expect(h).toBeGreaterThan(prev)
      prev = h
    }
  })
  it('境界が連続（125枚と126枚の間に段差がない）', () => {
    const gap = heightMmFromLeaves(126) - heightMmFromLeaves(125)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(4) // 2mm×複利ぶん程度
  })
})

describe('leavesForHeightMm（逆関数）', () => {
  it('高さmm以上になる最小の整数葉数を返す', () => {
    expect(leavesForHeightMm(5)).toBe(3)    // アリ5mm→葉3枚目
    expect(leavesForHeightMm(70)).toBe(35)  // 湯のみ7cm→葉35枚
    expect(leavesForHeightMm(250)).toBe(125) // ネコ25cm→葉125枚
  })
  it('往復整合: 任意の目盛りmmで heightMm(leaves(mm)) >= mm かつ heightMm(leaves(mm)-1) < mm', () => {
    for (const mm of [5, 8, 20, 35, 70, 100, 250, 398, 750, 15000, 54800, 3_776_000]) {
      const n = leavesForHeightMm(mm)
      expect(heightMmFromLeaves(n)).toBeGreaterThanOrEqual(mm)
      expect(heightMmFromLeaves(n - 1)).toBeLessThan(mm)
    }
  })
})

describe('formatHeight', () => {
  it('mm/cm/mを桁で切り替える', () => {
    expect(formatHeight(6)).toBe('6mm')
    expect(formatHeight(70)).toBe('7cm')
    expect(formatHeight(252)).toBe('25.2cm')
    expect(formatHeight(3_776_000)).toBe('3776m')
  })
})

describe('ラダーv2', () => {
  it('23目盛り＋遠い夢=富士山。実寸は確定値のまま（1mmも動かさない）', () => {
    expect(LADDER).toHaveLength(23)
    expect(LADDER[0]).toMatchObject({ mm: 5, label: 'アリ' })
    expect(LADDER[4]).toMatchObject({ mm: 70, label: '湯のみ' })
    expect(LADDER[6]).toMatchObject({ mm: 250, label: 'ネコ' })
    expect(LADDER[17]).toMatchObject({ mm: 54_800, label: '五重塔' })
    expect(LADDER[22]).toMatchObject({ mm: 3_015_000, label: '立山' })
    expect(FAR_DREAM).toMatchObject({ mm: 3_776_000, label: '富士山' })
  })
  it('mmは狭義単調増加・必要葉数も狭義単調増加', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(LADDER[i].mm).toBeGreaterThan(LADDER[i - 1].mm)
      expect(LADDER[i].leaves).toBeGreaterThan(LADDER[i - 1].leaves)
    }
  })
  it('上段5件（那智の滝〜立山）はprovisional（画風テスト後に確定）', () => {
    expect(LADDER.slice(18).every((m) => m.provisional)).toBe(true)
    expect(LADDER.slice(0, 18).every((m) => !m.provisional)).toBe(true)
  })
  it('初日で最初の実物: アリは葉3枚で越えられる', () => {
    expect(LADDER[0].leaves).toBe(3)
  })
})

describe('nextMilestone / passedMilestones', () => {
  it('葉0→つぎはアリ、葉3→アリは越えた・つぎはテントウムシ', () => {
    expect(nextMilestone(0).label).toBe('アリ')
    expect(nextMilestone(3).label).toBe('テントウムシ')
    expect(passedMilestones(3).map((m) => m.label)).toEqual(['アリ'])
  })
  it('全ラダーを越えたら次は富士山（遠い夢）', () => {
    const beyond = LADDER[22].leaves
    expect(nextMilestone(beyond).label).toBe('富士山')
    expect(passedMilestones(beyond)).toHaveLength(23)
  })
})

describe('sceneForLeaves', () => {
  it('次の実物が画面高の70%に収まる縮尺', () => {
    const s = sceneForLeaves(40, 600) // 湯のみは越えた・つぎはスズメ100mm
    expect(s.next.label).toBe('スズメ')
    expect(s.pxPerMm).toBeCloseTo((600 * 0.7) / 100, 5)
    expect(s.prevMm).toBe(70)
  })
  it('葉0でもシーンが成立（prevMm=0・つぎはアリ）', () => {
    const s = sceneForLeaves(0, 600)
    expect(s.next.label).toBe('アリ')
    expect(s.prevMm).toBe(0)
  })
})
