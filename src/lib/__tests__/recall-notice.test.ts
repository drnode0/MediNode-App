// 「確かめる」で開けるカードが無いときの一言。過ぎた期限を「◯日後」と告げる取り違えが
// 何度も出ているので、日数を出してよい条件をここで固定する。
import { describe, it, expect } from 'vitest'
import { checkNotice } from '@/lib/recall/notice'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const DAY = 86400000

describe('checkNotice', () => {
  it('開けるカードがあるときは何も言わない', () => {
    expect(checkNotice(3, null, NOW)).toBeNull()
    expect(checkNotice(1, { at: new Date(NOW.getTime() + DAY), count: 4, overdue: false }, NOW)).toBeNull()
  })

  it('残した記録がまったく無いときは、残し方を案内する', () => {
    const msg = checkNotice(0, null, NOW)
    expect(msg).toContain('まだ残した主張がありません')
    expect(msg).toContain('残す')
    expect(msg).not.toContain('日後')
  })

  it('先の期限は「◯日後に◯件」', () => {
    expect(checkNotice(0, { at: new Date(NOW.getTime() + DAY * 3), count: 2, overdue: false }, NOW))
      .toBe('いま確かめる主張はありません。次は 3 日後に 2 件')
    // 24時間に満たない先の期限でも 0 日後とは言わない
    expect(checkNotice(0, { at: new Date(NOW.getTime() + 60_000), count: 1, overdue: false }, NOW))
      .toBe('いま確かめる主張はありません。次は 1 日後に 1 件')
  })

  it('期限が来ているときは件数だけを告げる', () => {
    expect(checkNotice(0, { at: new Date(NOW), count: 5, overdue: true }, NOW))
      .toBe('いま確かめる主張はありません。期限が来ている主張が 5 件あります')
  })

  it('過ぎた日付は、overdue の印が付いていなくても「◯日後」にしない', () => {
    const msg = checkNotice(0, { at: new Date(NOW.getTime() - DAY * 2), count: 7, overdue: false }, NOW)
    expect(msg).not.toContain('日後')
    expect(msg).toContain('7 件')
  })
  // ── 惑星ごとに確かめる（決定2）。席名を渡したときだけ惑星の文言になる ──
  it('席名を渡すと、惑星単位の文言になる', () => {
    expect(checkNotice(0, { at: new Date(NOW.getTime() + DAY * 3), count: 2, overdue: false }, NOW, '呼吸'))
      .toBe('この惑星に、いま確かめる主張はありません。次は 3 日後に 2 件')
  })

  it('席名を渡しても、期限が過ぎているときは日数を出さない', () => {
    const msg = checkNotice(0, { at: NOW, count: 4, overdue: true }, NOW, '呼吸')
    expect(msg).toContain('この惑星に')
    expect(msg).toContain('4 件')
    expect(msg).not.toContain('日後')
    // 印が無くても、日時そのものが過去なら日数を出さない（二重の歯止めを惑星でも守る）
    const past = checkNotice(0, { at: new Date(NOW.getTime() - DAY), count: 1, overdue: false }, NOW, '呼吸')
    expect(past).not.toContain('日後')
  })

  it('席名を渡し、その惑星に残した記録が無いときは残し方を案内する', () => {
    const msg = checkNotice(0, null, NOW, '呼吸')
    expect(msg).toContain('この惑星に')
    expect(msg).toContain('残す')
    expect(msg).not.toContain('日後')
    // 惑星の文言に球は出てこない
    expect(msg).not.toContain('球')
  })

  it('席名を渡しても、開けるカードがあるときは何も言わない', () => {
    expect(checkNotice(2, null, NOW, '呼吸')).toBeNull()
  })

  it('禁止語彙「落ちる」を使わない', () => {
    const msgs = [
      checkNotice(0, null, NOW, '呼吸'),
      checkNotice(0, { at: NOW, count: 1, overdue: true }, NOW, '呼吸'),
      checkNotice(0, { at: new Date(NOW.getTime() + DAY), count: 1, overdue: false }, NOW, '呼吸'),
    ]
    for (const m of msgs) expect(m).not.toContain('落ち')
  })
})
