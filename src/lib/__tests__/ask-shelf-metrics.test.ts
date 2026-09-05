import { describe, it, expect } from 'vitest'
import { notSentRate, resubmitAfterDecline } from '@/lib/ask-shelf/metrics'

describe('notSentRate（段0を見せた後に送らずに済んだ割合）', () => {
  it('送らなかった割合を出す', () => {
    expect(notSentRate([{ submitted: false }, { submitted: false }, { submitted: true }]))
      .toEqual({ shown: 3, notSent: 2, rate: 2 / 3 })
  })
  it('1件も無ければ割合は0（0除算にしない）', () => {
    expect(notSentRate([])).toEqual({ shown: 0, notSent: 0, rate: 0 })
  })
})

describe('resubmitAfterDecline（記事化しないを見た後の再投稿）', () => {
  const rich = (v: string) => ({ rich_text: [{ plain_text: v }] })
  const page = (userId: string, status: string, created: string) => ({
    id: created, created_time: created,
    properties: { 通知先ユーザーID: rich(userId), 対応状態: { select: status ? { name: status } : null } },
  } as never)

  it('対応不要になった人が30日以内に出し直した件数を数える', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u1', '', '2026-08-10T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(1)
  })
  it('30日を過ぎた出し直しは数えない', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u1', '', '2026-09-04T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(0)
  })
  it('別の人の投稿は数えない', () => {
    const pages = [page('u1', '対応不要', '2026-08-01T00:00:00Z'), page('u2', '', '2026-08-10T00:00:00Z')]
    expect(resubmitAfterDecline(pages, new Date('2026-09-05T00:00:00Z'))).toBe(0)
  })
})
