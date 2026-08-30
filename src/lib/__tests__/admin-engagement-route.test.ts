import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { jstDateKey } from '../admin-daily'

const { requireAdminMock, adminClientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  adminClientMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
// Algolia は呼ばれても no-op（タイトル解決は best-effort）。
vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => ({ getObjects: async () => ({ results: [] }) }) }),
}))

import { GET } from '../../app/api/admin/engagement/route'

beforeEach(() => {
  requireAdminMock.mockReset()
  adminClientMock.mockReset()
  // 時刻を固定する（Dateのみ。setTimeout等は実物のままでasyncを止めない）。
  // ルートは jstDateKey で「今日」を出すため、実時刻のままだとJST 00:00〜09:00
  // （=UTCの前日）にフィクスチャの used_on と食い違って落ちる。
  // 固定値はJST 00:30（=UTCでは前日15:30）。UTC日付で書き直すと必ず落ちる時刻を
  // あえて選んでいる（同じ取り違えが戻ったらその場で分かる）。
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-31T00:30:00+09:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/admin/engagement', () => {
  it('admin不許可なら guard のレスポンスを返す', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'login_required' }, { status: 401 }),
    })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('一部テーブルが失敗しても他ブロックは返す（best-effort）', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })

    // アプリ側と同じJST基準の日付キーで作る（UTC日付だとJST午前中にずれる）。
    const todayIso = jstDateKey(Date.now())
    // from(table) ごとに挙動を出し分ける薄いスタブ。
    adminClientMock.mockReturnValue({
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [] }, error: null }),
        },
      },
      from: (table: string) => {
        if (table === 'app_usage_daily') {
          // used_on=今日 の2行 → DAU today=2
          const rows = [
            { user_id: 'a', used_on: todayIso },
            { user_id: 'b', used_on: todayIso },
          ]
          return {
            select: () => ({ gte: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
          }
        }
        if (table === 'push_subscriptions') {
          // ここだけ失敗させる → push は null、それでも他は返る
          return { select: async () => ({ data: null, error: { message: 'no table' } }) }
        }
        // その他テーブルは空データ
        return {
          select: () => ({
            gte: async () => ({ data: [], error: null }),
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
            // subscriptions / app_usage の select().then 相当（await 可能に）
            then: (resolve: (v: { data: never[]; error: null }) => unknown) =>
              resolve({ data: [], error: null }),
          }),
        }
      },
    })

    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.usage.today).toBe(2)
    expect(data.stickiness.dau).toBe(2)
    // push は失敗しても null で返る（全体は落ちない）
    expect(data.push).toBeNull()
    expect(data.generatedAt).toBeTruthy()
  })
})
