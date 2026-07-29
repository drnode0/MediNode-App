import { describe, it, expect, vi, beforeEach } from 'vitest'

const { premiumMock } = vi.hoisted(() => ({ premiumMock: vi.fn() }))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))

import { GET } from '../../app/api/garden/link/route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TAIJU_KEY = 'premium-key'
})

describe('/api/garden/link', () => {
  it('プレミアムはkey付きURL', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1', email: 'a@b.c' })
    const body = await (await GET()).json()
    expect(body.url).toBe('https://chi-no-niwa.vercel.app/?taiju=1&key=premium-key')
  })
  it('無料は素のURL', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: null, email: null })
    const body = await (await GET()).json()
    expect(body.url).toBe('https://chi-no-niwa.vercel.app/?taiju=1')
  })
  it('TAIJU_KEY未設定ならプレミアムでも素のURL', async () => {
    delete process.env.TAIJU_KEY
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1', email: 'a@b.c' })
    const body = await (await GET()).json()
    expect(body.url).toBe('https://chi-no-niwa.vercel.app/?taiju=1')
  })
  it('判定関数の障害時も素のURLで200', async () => {
    premiumMock.mockRejectedValue(new Error('down'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://chi-no-niwa.vercel.app/?taiju=1')
  })
})
