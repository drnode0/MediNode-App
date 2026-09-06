import { describe, it, expect } from 'vitest'
import { DAILY_LIMIT, jstDayStart, dailyLimitState, noticeAfterStage1 } from '@/lib/ask-shelf/stage1-limit'

describe('jstDayStart', () => {
  it('JST の正午は、その日の JST 0時(＝前日 15:00 UTC)になる', () => {
    // 2026-09-06 12:00 JST = 2026-09-06 03:00 UTC
    expect(jstDayStart(new Date('2026-09-06T03:00:00Z')).toISOString()).toBe('2026-09-05T15:00:00.000Z')
  })

  it('UTC の日付が変わっても JST の同じ日なら同じ境界になる', () => {
    // 2026-09-06 08:59 JST(前日 23:59 UTC)と 2026-09-06 09:01 JST(同日 00:01 UTC)
    const a = jstDayStart(new Date('2026-09-05T23:59:00Z')).toISOString()
    const b = jstDayStart(new Date('2026-09-06T00:01:00Z')).toISOString()
    expect(a).toBe(b)
    expect(a).toBe('2026-09-05T15:00:00.000Z')
  })

  it('JST の 0時ちょうどは、その日の境界そのものになる', () => {
    expect(jstDayStart(new Date('2026-09-05T15:00:00Z')).toISOString()).toBe('2026-09-05T15:00:00.000Z')
  })
})

describe('dailyLimitState', () => {
  it('0回なら止めず、残りは上限そのもの', () => {
    expect(dailyLimitState(0)).toEqual({ blocked: false, remaining: DAILY_LIMIT, notice: null })
  })

  it('上限に達したら止める', () => {
    const s = dailyLimitState(DAILY_LIMIT)
    expect(s.blocked).toBe(true)
    expect(s.remaining).toBe(0)
    expect(s.notice).toBe('本日の整理は上限に達しました。')
  })

  it('残り1回のときだけ案内を出す。ふだんは数を見せない', () => {
    expect(dailyLimitState(DAILY_LIMIT - 1).notice).toBe('本日お使いいただける整理は、あと1回です。')
    expect(dailyLimitState(DAILY_LIMIT - 2).notice).toBeNull()
  })

  it('記録が上限を超えていても残りは負にならない', () => {
    expect(dailyLimitState(DAILY_LIMIT + 5).remaining).toBe(0)
  })
})

describe('noticeAfterStage1', () => {
  // monthly-limit.ts の noticeAfterSubmission と同じ一つずれの罠を避ける。
  // 数えた count は「この呼び出しが記録される前」の件数なので、+1 してから判定する。
  it('この呼び出しで残り1回になるときだけ「あと1回」と伝える', () => {
    expect(noticeAfterStage1(DAILY_LIMIT - 2).notice).toBe('本日お使いいただける整理は、あと1回です。')
    expect(noticeAfterStage1(DAILY_LIMIT - 2).remaining).toBe(1)
  })

  it('この呼び出しでちょうど上限に達したら、案内は出さない(成功の返事に止め文言を混ぜない)', () => {
    expect(noticeAfterStage1(DAILY_LIMIT - 1)).toEqual({ remaining: 0, notice: null })
  })

  it('まだ余裕があるときは何も言わない', () => {
    expect(noticeAfterStage1(0)).toEqual({ remaining: DAILY_LIMIT - 1, notice: null })
  })
})
