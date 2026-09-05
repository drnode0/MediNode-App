import { describe, it, expect } from 'vitest'
import { countRecentSubmissions, monthlyLimitState, MONTHLY_LIMIT } from '@/lib/ask-shelf/monthly-limit'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const page = (userId: string, created: string) => ({
  id: created, created_time: created,
  properties: { 通知先ユーザーID: { rich_text: [{ plain_text: userId }] } },
} as never)

describe('countRecentSubmissions', () => {
  it('直近30日の自分の投稿だけを数える', () => {
    const pages = [page('u1', '2026-09-29T00:00:00Z'), page('u1', '2026-08-01T00:00:00Z'), page('u2', '2026-09-29T00:00:00Z')]
    expect(countRecentSubmissions(pages, 'u1', NOW)).toBe(1)
  })
  it('ちょうど30日前は窓の中に入れる', () => {
    expect(countRecentSubmissions([page('u1', '2026-08-31T00:00:01Z')], 'u1', NOW)).toBe(1)
  })
  it('通知に同意していない投稿は数えられない（紐付けが無い）', () => {
    expect(countRecentSubmissions([page('', '2026-09-29T00:00:00Z')], 'u1', NOW)).toBe(0)
  })
})

describe('monthlyLimitState', () => {
  it('上限に達したら止める', () => {
    expect(monthlyLimitState(MONTHLY_LIMIT).blocked).toBe(true)
  })
  it('残り1件のときだけ案内を出す（ふだんは黙っている）', () => {
    expect(monthlyLimitState(MONTHLY_LIMIT - 1).notice).toContain('あと1件')
    expect(monthlyLimitState(0).notice).toBeNull()
  })
})
