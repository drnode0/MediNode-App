import { describe, it, expect, vi, beforeEach } from 'vitest'

const { premiumMock, adminClientMock } = vi.hoisted(() => ({
  premiumMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))

import { GET } from '../../app/api/cq/helpfuls/route'

const get = (ids?: string) =>
  GET(new Request(`http://localhost/api/cq/helpfuls${ids !== undefined ? `?ids=${ids}` : ''}`))

// select('object_id, user_id').in(...) が rows を返す薄いスタブ。
function rowsStub(rows: Array<{ object_id: string; user_id: string }> | null, error: { message: string } | null = null) {
  return {
    from: (table: string) => {
      expect(table).toBe('cq_reactions')
      return { select: () => ({ in: async () => ({ data: rows, error }) }) }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  premiumMock.mockResolvedValue({ premium: false, userId: null })
})

describe('GET /api/cq/helpfuls', () => {
  it('counts は対象ごとの合計、mine は自分の分だけ', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'me' })
    adminClientMock.mockReturnValue(rowsStub([
      { object_id: 'a', user_id: 'me' },
      { object_id: 'a', user_id: 'other1' },
      { object_id: 'b', user_id: 'other2' },
    ]))
    const res = await get('a,b,c')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counts: { a: 2, b: 1 }, mine: ['a'] })
  })

  it('未ログインでも counts は返る（mine は空）', async () => {
    adminClientMock.mockReturnValue(rowsStub([
      { object_id: 'a', user_id: 'other1' },
    ]))
    const body = await (await get('a')).json()
    expect(body).toEqual({ counts: { a: 1 }, mine: [] })
  })

  it('ids なし・空は空の200', async () => {
    expect(await (await get()).json()).toEqual({ counts: {}, mine: [] })
    expect(await (await get('')).json()).toEqual({ counts: {}, mine: [] })
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('テーブル未適用などの失敗は空の200に劣化（バッジが出ないだけ）', async () => {
    adminClientMock.mockReturnValue(rowsStub(null, { message: 'no table' }))
    const res = await get('a')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counts: {}, mine: [] })
  })
})
