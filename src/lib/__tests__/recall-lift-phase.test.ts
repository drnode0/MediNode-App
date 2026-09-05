// 隠しコマンドの覆いの段（設計 2026-09-05 再計画 §4.1 の遷移表）。
// 画面を持たない純関数なので、全経路をここで担保する。
import { describe, it, expect } from 'vitest'
import { liftOpen, liftNext, liftButtons, liftCaption } from '@/lib/recall/lift-phase'

describe('覆いの段（再計画 §4.1）', () => {
  it('分野ページから開くと球。戻るで閉じる', () => {
    const p = liftOpen(3)
    expect(p).toEqual({ kind: 'sphere', slot: 3, from: 'page' })
    expect(liftNext(p, { type: 'back' })).toBeNull()
    expect(liftButtons(p)).toEqual({ back: '戻る', toSpace: true })
    expect(liftCaption(p)).toEqual({ top: 3, below: null })
  })

  it('さらに宇宙へ → 宇宙（焦点なし）。宇宙の戻るで閉じる', () => {
    const s = liftNext(liftOpen(3), { type: 'toSpace' })!
    expect(s).toEqual({ kind: 'space', focus: null })
    expect(liftButtons(s)).toEqual({ back: '戻る', toSpace: false })
    expect(liftCaption(s)).toEqual({ top: null, below: null })
    expect(liftNext(s, { type: 'back' })).toBeNull()
  })

  it('宇宙で中景に寄ると焦点。名前は惑星の下。遠景に戻ると消える', () => {
    const s = liftNext(liftOpen(3), { type: 'toSpace' })!
    const m = liftNext(s, { type: 'stage', stage: 'mid', slot: 5 })!
    expect(m).toEqual({ kind: 'space', focus: 5 })
    expect(liftCaption(m)).toEqual({ top: null, below: 5 })
    expect(liftNext(m, { type: 'stage', stage: 'far', slot: null })).toEqual({ kind: 'space', focus: null })
  })

  it('中景で惑星を押すと球（宇宙から）。その戻るは宇宙へ', () => {
    const m = { kind: 'space', focus: 5 } as const
    const b = liftNext(m, { type: 'planetTap', slot: 5 })!
    expect(b).toEqual({ kind: 'sphere', slot: 5, from: 'space' })
    expect(liftButtons(b)).toEqual({ back: '宇宙へ戻る', toSpace: false })
    expect(liftNext(b, { type: 'back' })).toEqual({ kind: 'space', focus: 5 })
  })

  it('球では stage の合図を無視する（lockNear で出ないため）', () => {
    const p = liftOpen(3)
    expect(liftNext(p, { type: 'stage', stage: 'mid', slot: null })).toEqual(p)
  })

  it('球→宇宙→中景→球→宇宙→閉じる を通しで', () => {
    let p: ReturnType<typeof liftNext> = liftOpen(3)
    p = liftNext(p!, { type: 'toSpace' })
    p = liftNext(p!, { type: 'stage', stage: 'mid', slot: 12 })
    p = liftNext(p!, { type: 'planetTap', slot: 12 })
    expect(p).toEqual({ kind: 'sphere', slot: 12, from: 'space' })
    p = liftNext(p!, { type: 'back' })
    expect(p).toEqual({ kind: 'space', focus: 12 })
    expect(liftNext(p!, { type: 'back' })).toBeNull()
  })
})
