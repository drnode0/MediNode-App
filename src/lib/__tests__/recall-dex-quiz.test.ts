// 標本帳（図鑑）タスク11: 「確かめる」の列（キュー）を進める純関数。
// 描画はテストできない（DOM を持たない）ので、進み方の判断だけをここで確かめる。
import { describe, it, expect } from 'vitest'
import { startRun, advance, nextSweepSlot, runSummary, type QuizRun } from '@/lib/recall/dex-quiz'
import type { PlateModel } from '@/lib/recall/dex'
import type { NextDue } from '@/lib/recall/srs'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const DAY = 86400000

// nextSweepSlot 用の最小 PlateModel。escaping だけを動かす。
const plate = (slot: number, escaping: number): PlateModel => ({
  slot, label: '', en: '', kind: 'flow', kindEn: 'Flow',
  n: 0, kept: 0, settled: 0, touched: 0, cold: 0, escaping, tray: [],
})

describe('startRun', () => {
  it('候補が 0 件なら null', () => {
    expect(startRun(4, [], false)).toBeNull()
  })

  it('候補があれば先頭を指す列を作る（answered は 0 から）', () => {
    const run = startRun(4, ['a', 'b', 'c'], true)
    expect(run).toEqual({ slot: 4, queue: ['a', 'b', 'c'], index: 0, answered: 0, sweep: true })
  })
})

describe('advance', () => {
  const run = (over: Partial<QuizRun> = {}): QuizRun => ({
    slot: 4, queue: ['a', 'b', 'c'], index: 0, answered: 0, sweep: false, ...over,
  })

  it('次のカードがあれば index・answered を1つ進める', () => {
    const next = advance(run())
    expect(next).toEqual({ slot: 4, queue: ['a', 'b', 'c'], index: 1, answered: 1, sweep: false })
  })

  it('末尾（最後の1枚を答えた後）は null（終わり）', () => {
    expect(advance(run({ index: 2, answered: 2 }))).toBeNull()
  })

  it('1件しかない列は、1枚目を答えると即 null', () => {
    expect(advance(run({ queue: ['a'], index: 0, answered: 0 }))).toBeNull()
  })
})

describe('nextSweepSlot', () => {
  it('離れかけのある分野が1つも無ければ null', () => {
    expect(nextSweepSlot([plate(1, 0), plate(2, 0)], null)).toBeNull()
  })

  it('current が null なら、離れかけのある分野の先頭（席番号順）', () => {
    const plates = [plate(5, 1), plate(1, 2), plate(3, 0)]
    expect(nextSweepSlot(plates, null)).toBe(1)
  })

  it('current の次の分野を返す（並びは席番号順。plates の受け取り順には頼らない）', () => {
    const plates = [plate(5, 1), plate(1, 2), plate(3, 1)]
    expect(nextSweepSlot(plates, 1)).toBe(3)
    expect(nextSweepSlot(plates, 3)).toBe(5)
  })

  it('末尾の次は null', () => {
    const plates = [plate(1, 1), plate(5, 1)]
    expect(nextSweepSlot(plates, 5)).toBeNull()
  })

  it('離れかけの無い分野は飛ばす', () => {
    const plates = [plate(1, 1), plate(2, 0), plate(3, 1)]
    expect(nextSweepSlot(plates, 1)).toBe(3)
  })

  it('current がすでに離れかけの一覧に無くても、その次の席番号から続く', () => {
    // 直前のカードで離れかけが尽きて escaping が 0 に落ちた分野。次の巡回先はそのまま先へ。
    const plates = [plate(1, 0), plate(2, 1)]
    expect(nextSweepSlot(plates, 1)).toBe(2)
  })
})

describe('runSummary', () => {
  const run = (answered: number): QuizRun => ({ slot: 4, queue: ['a', 'b'], index: 1, answered, sweep: false })

  it('答えた件数と、先の期限（日数）を続けて言う', () => {
    const next: NextDue = { at: new Date(NOW.getTime() + DAY * 3), count: 2, overdue: false }
    expect(runSummary(run(2), next, NOW)).toBe('2件を確かめました。次は 3 日後に 2 件')
  })

  it('期限が来ているときは日数を出さず件数だけ', () => {
    const next: NextDue = { at: NOW, count: 5, overdue: true }
    expect(runSummary(run(5), next, NOW)).toBe('5件を確かめました。次は期限が来ている主張が 5 件あります')
  })

  it('overdue の印が無くても、日時そのものが過去なら「日後」を作らない（checkNotice と同じ二重の歯止め）', () => {
    const next: NextDue = { at: new Date(NOW.getTime() - DAY), count: 1, overdue: false }
    const msg = runSummary(run(1), next, NOW)
    expect(msg).not.toContain('日後')
    expect(msg).toContain('1 件')
  })

  it('次の期限が無ければ、確かめる主張がないと言う', () => {
    expect(runSummary(run(3), null, NOW)).toBe('3件を確かめました。次に確かめる主張はいまありません')
  })

  it('件数を答え終えても 0 なら（起こらない前提だが）0件と言う', () => {
    expect(runSummary(run(0), null, NOW)).toContain('0件を確かめました')
  })
})
