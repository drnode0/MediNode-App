import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { premiumMock, adminClientMock } = vi.hoisted(() => ({
  premiumMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => true) }))

import { GET, POST } from '../../app/api/subscription/question-interest/route'

const BLOCK = '6188f6885c10404d9bec678c3a050be2'
const PAGE = '3cbfd7567370814185e3da90f1864550'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/subscription/question-interest', { method: 'POST', body: JSON.stringify(body) }))

// from('question_interest') の薄いスタブ。upsert / delete を記録し、合計 count を返す。
function interestStub(count: number) {
  const upsert = vi.fn(async () => ({ error: null }))
  const deleteEqEq = vi.fn(async () => ({ error: null }))
  const del = vi.fn(() => ({ eq: () => ({ eq: deleteEqEq }) }))
  const stub = {
    from: (table: string) => {
      expect(table).toBe('question_interest')
      return {
        upsert,
        delete: del,
        select: () => ({ eq: async () => ({ count }) }),
      }
    },
  }
  return { stub, upsert, del }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})

describe('POST /api/subscription/question-interest', () => {
  it('未ログインは401（DBに触らない）', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: null })
    const res = await post({ blockId: BLOCK, pageId: PAGE, voted: true })
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('非プレミアムは403', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: 'u1' })
    const res = await post({ blockId: BLOCK, pageId: PAGE, voted: true })
    expect(res.status).toBe(403)
  })

  it('blockId が32桁hexでなければ400（自由文字列を主キーに入れさせない）', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const res = await post({ blockId: 'not-a-block', pageId: PAGE, voted: true })
    expect(res.status).toBe(400)
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('voted=true は upsert（1人1票）で入り、最新の合計を返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, upsert } = interestStub(3)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ blockId: BLOCK, pageId: PAGE, voted: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, count: 3 })
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', block_id: BLOCK, page_id: PAGE },
      { onConflict: 'user_id,block_id' },
    )
  })

  it('ハイフンつきのIDは正規化して保存する', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, upsert } = interestStub(1)
    adminClientMock.mockReturnValue(stub)
    const res = await post({
      blockId: '6188f688-5c10-404d-9bec-678c3a050be2',
      pageId: '3cbfd756-7370-8141-85e3-da90f1864550',
      voted: true,
    })
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', block_id: BLOCK, page_id: PAGE },
      { onConflict: 'user_id,block_id' },
    )
  })

  it('voted=false は行を消す（取り消し）', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, del } = interestStub(0)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ blockId: BLOCK, pageId: PAGE, voted: false })
    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalled()
  })
})

describe('GET /api/subscription/question-interest', () => {
  const get = (ids: string) =>
    GET(new NextRequest(`http://localhost/api/subscription/question-interest?ids=${ids}`))

  it('合計は誰でも引けるが、mine は本人の分だけ返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    adminClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [
              { block_id: BLOCK, user_id: 'u1' },
              { block_id: BLOCK, user_id: 'u2' },
            ],
            error: null,
          }),
        }),
      }),
    })
    const res = await get(BLOCK)
    expect(await res.json()).toEqual({ counts: { [BLOCK]: 2 }, mine: [BLOCK] })
  })

  it('不正なidは黙って捨てる（DBに渡さない）', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: null })
    const inMock = vi.fn(async () => ({ data: [], error: null }))
    adminClientMock.mockReturnValue({ from: () => ({ select: () => ({ in: inMock }) }) })
    await get(`${BLOCK},ゴミ,'; drop table--`)
    expect(inMock).toHaveBeenCalledWith('block_id', [BLOCK])
  })
})
