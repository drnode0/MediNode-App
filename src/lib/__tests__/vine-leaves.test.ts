import { describe, expect, it } from 'vitest'
import type { QuizStat } from '../quiz-srs'
import type { Step } from '../tower-steps'
import { fadeLevel, buildLeafVisuals, spotlightFaded, pendingBudIds } from '../vine-leaves'

const NOW = '2026-08-01T12:00:00.000Z'
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()
const ok = (lastDaysAgo: number): QuizStat => ({ ok: 1, ng: 0, last: daysAgo(lastDaysAgo), lastResult: 'ok' })
const step = (id: string, kind: Step['kind']): Step => ({ id, kind, at: daysAgo(10), genre: '', title: `T-${id}` })

describe('fadeLevel（色褪せは失敗ではなく再学習の合図。数値は議事録A-2の段階遷移）', () => {
  it('鮮度が高ければ0', () => {
    expect(fadeLevel(ok(1), NOW)).toBe(0)
    expect(fadeLevel(ok(89), NOW)).toBe(0)
  })
  it('期限日(90日)から2日かけて微減（最大0.15）', () => {
    expect(fadeLevel(ok(90), NOW)).toBe(0)
    expect(fadeLevel(ok(91), NOW)).toBeCloseTo(0.075, 3)
    expect(fadeLevel(ok(92), NOW)).toBeCloseTo(0.15, 3)
  })
  it('+2〜+7日ではっきり褪せ、以後は1で打ち止め（枯れ落ちなし）', () => {
    expect(fadeLevel(ok(94.5), NOW)).toBeCloseTo(0.5, 2)
    expect(fadeLevel(ok(97), NOW)).toBe(1)
    expect(fadeLevel(ok(400), NOW)).toBe(1)
  })
  it('クイズ失敗（lastResult=ng）は即1', () => {
    expect(fadeLevel({ ok: 3, ng: 1, last: daysAgo(0), lastResult: 'ng' }, NOW)).toBe(1)
  })
  it('statなし（クイズ未通過）は0——輪郭の葉は褪せる対象ですらない', () => {
    expect(fadeLevel(undefined, NOW)).toBe(0)
  })
})

describe('buildLeafVisuals（導出表: read=輪郭不褪／wrote=双葉不褪／recall系のみ褪せる）', () => {
  it('kindごとの形と、照り葉（repolish歴あり・fade0）', () => {
    const steps = [step('a', 'read'), step('b', 'wrote'), step('c', 'recall'), step('d', 'repolish')]
    const stats = { c: ok(1), d: ok(1) }
    const v = buildLeafVisuals(steps, stats, NOW)
    expect(v[0]).toEqual({ form: 'outline', fade: 0, teri: false, line: 0 })
    expect(v[1]).toEqual({ form: 'futaba', fade: 0, teri: false, line: 0 })
    expect(v[2]).toEqual({ form: 'green', fade: 0, teri: false, line: 0 })
    expect(v[3]).toEqual({ form: 'green', fade: 0, teri: true, line: 0 }) // 磨き直した葉は照る
  })
  it('resolved は緑・褪せない・照りなし（生成行為の完成形）', () => {
    const v = buildLeafVisuals([step('r', 'resolved')], {}, NOW)
    expect(v[0]).toMatchObject({ form: 'green', fade: 0, teri: false })
  })
  it('同じidのrecall葉も、repolish歴があれば照る（idごとの履歴で判定）', () => {
    const steps = [step('x', 'recall'), step('x', 'repolish')]
    const v = buildLeafVisuals(steps, { x: ok(1) }, NOW)
    expect(v[0].teri).toBe(true)
  })
  it('色褪せ中は照らない', () => {
    const v = buildLeafVisuals([step('y', 'repolish')], { y: ok(100) }, NOW)
    expect(v[0]).toMatchObject({ form: 'green', fade: 1, teri: false })
  })
})

describe('読み返しの濃度と半戻り（§9）', () => {
  it('輪郭の線は再読回数で濃くなる（0〜3）', () => {
    const rereads = { a: { count: 2, lastAt: NOW } }
    const v = buildLeafVisuals([step('a', 'read')], {}, NOW, rereads)
    expect(v[0].line).toBe(2)
    expect(buildLeafVisuals([step('a', 'read')], {}, NOW)[0].line).toBe(0)
  })
  it('褪せた青葉は最後のクイズより新しい再読で色が半分戻る・照りは出ない', () => {
    const stats = { a: ok(200) }
    const faded = buildLeafVisuals([step('a', 'recall')], stats, NOW)[0]
    expect(faded.fade).toBe(1)
    const rereads = { a: { count: 1, lastAt: daysAgo(5) } }
    const half = buildLeafVisuals([step('a', 'recall')], stats, NOW, rereads)[0]
    expect(half.fade).toBe(0.5)
    expect(half.teri).toBe(false)
  })
  it('最後のクイズより古い再読では戻らない', () => {
    const stats = { a: ok(200) }
    const rereads = { a: { count: 1, lastAt: daysAgo(300) } }
    expect(buildLeafVisuals([step('a', 'recall')], stats, NOW, rereads)[0].fade).toBe(1)
  })
})

describe('まだの芽（§9: attemptは穂先の未展開葉）', () => {
  it('attemptだけのidが芽。recall/repolishが来たら開いた（=芽から消える）', () => {
    const steps = [step('a', 'attempt'), step('b', 'attempt'), step('b', 'recall'), step('c', 'read')]
    expect(pendingBudIds(steps)).toEqual(['a'])
  })
  it('同じidの芽は1つ', () => {
    expect(pendingBudIds([step('a', 'attempt'), step('a', 'attempt')])).toEqual(['a'])
  })
})

describe('spotlightFaded（目立たせるのは最大3枚・lastが新しい順。数字での集計は永久にしない）', () => {
  it('fade=1のidだけを、lastが新しい順に最大3件', () => {
    const steps = ['a', 'b', 'c', 'd', 'e'].map((id) => step(id, 'recall'))
    const stats = { a: ok(100), b: ok(120), c: ok(98), d: ok(50), e: ok(200) }
    expect(spotlightFaded(steps, stats, NOW)).toEqual(['c', 'a', 'b']) // dはまだ褪せてない・eは4番目
  })
  it('limit指定を尊重・重複idは1回だけ', () => {
    const steps = [step('a', 'recall'), step('a', 'repolish')]
    expect(spotlightFaded(steps, { a: ok(100) }, NOW, 1)).toEqual(['a'])
  })
})
