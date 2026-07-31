import { describe, it, expect } from 'vitest'
import { deriveVolumes, dullIds, jitterFor, lastLeafStep, aYearAgoStep, VOLUME_SIZE } from '../tower-volumes'
import type { Step } from '../tower-steps'
import type { QuizStat } from '../quiz-srs'

const mk = (i: number, over: Partial<Step> = {}): Step => ({
  id: `k${i}`, kind: 'wrote', at: `2026-01-${String((i % 27) + 1).padStart(2, '0')}T0${i % 9}:00:00.000Z`,
  genre: i % 3 === 0 ? '循環器' : '呼吸器', title: `知識${i}`, ...over,
})

describe('deriveVolumes: 30歩で製本・時系列', () => {
  it('65歩→2巻＋端数5歩。巻は古い順・中身はat昇順', () => {
    const steps = Array.from({ length: 65 }, (_, i) => mk(i))
    const { volumes, loose } = deriveVolumes(steps)
    expect(volumes).toHaveLength(2)
    expect(loose).toHaveLength(5)
    expect(volumes[0].n).toBe(1)
    expect(volumes[0].steps).toHaveLength(VOLUME_SIZE)
    const ats = volumes[0].steps.map((s) => s.at)
    expect([...ats].sort()).toEqual(ats)
    expect(volumes[0].from <= volumes[0].to).toBe(true)
  })
  it('縞はジャンルの構成比（多い順）・葉はrecall/repolishの数', () => {
    const steps = [
      ...Array.from({ length: 20 }, (_, i) => mk(i, { genre: '循環器' })),
      ...Array.from({ length: 8 }, (_, i) => mk(100 + i, { genre: '呼吸器' })),
      mk(200, { kind: 'recall', genre: '循環器' }),
      mk(201, { kind: 'repolish', genre: '循環器' }),
    ]
    const { volumes } = deriveVolumes(steps)
    expect(volumes[0].stripes[0].count).toBeGreaterThanOrEqual(volumes[0].stripes[1]?.count ?? 0)
    expect(volumes[0].leaves).toBe(2)
  })
})

describe('dullIds: 要再確認の集合', () => {
  it('最終okが90日以上前のidだけ入る（ng最終・鮮度あり・ok無しは入らない）', () => {
    const now = '2026-08-01T00:00:00.000Z'
    const stats: Record<string, QuizStat> = {
      stale: { ok: 1, ng: 0, last: '2026-04-01T00:00:00.000Z', lastResult: 'ok' },
      fresh: { ok: 1, ng: 0, last: '2026-07-20T00:00:00.000Z', lastResult: 'ok' },
      never: { ok: 0, ng: 2, last: '2026-04-01T00:00:00.000Z', lastResult: 'ng' },
    }
    const dull = dullIds(stats, now)
    expect(dull.has('stale')).toBe(true)
    expect(dull.has('fresh')).toBe(false)
    expect(dull.has('never')).toBe(false)
  })
})

describe('演出の決定性と振り返り', () => {
  it('jitterForは同じidに同じ値・範囲内', () => {
    const a = jitterFor('abc')
    expect(jitterFor('abc')).toEqual(a)
    expect(Math.abs(a.offset)).toBeLessThanOrEqual(8)
    expect(Math.abs(a.rot)).toBeLessThanOrEqual(2.5)
  })
  it('lastLeafStepは最新のrecall/repolish', () => {
    const steps = [mk(0), mk(1, { kind: 'recall', at: '2026-03-01T00:00:00.000Z' }), mk(2, { kind: 'repolish', at: '2026-05-01T00:00:00.000Z' })]
    expect(lastLeafStep(steps)?.at).toBe('2026-05-01T00:00:00.000Z')
    expect(lastLeafStep([mk(0)])).toBeNull()
  })
  it('aYearAgoStepは去年の同日±3日を拾い、無ければnull', () => {
    const steps = [mk(0, { at: '2025-08-02T00:00:00.000Z' }), mk(1, { at: '2025-01-01T00:00:00.000Z' })]
    expect(aYearAgoStep(steps, '2026-08-01T00:00:00.000Z')?.id).toBe('k0')
    expect(aYearAgoStep([mk(1, { at: '2025-01-01T00:00:00.000Z' })], '2026-08-01T00:00:00.000Z')).toBeNull()
  })
})
