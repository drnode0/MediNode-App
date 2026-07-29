import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))
vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => ({ search: searchMock }) }),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => true),
  clientIp: () => '127.0.0.1',
}))

import { GET } from '../../app/api/garden/taiju/route'

const req = (key?: string) =>
  new Request(`http://localhost/api/garden/taiju${key !== undefined ? `?key=${key}` : ''}`)

const HITS = [
  { objectID: 'a', source: 'medical', knowledgeLevel: '💡 ナレッジ', title: '秘密の題', createdAt: '2026-07-03T00:00:00.000Z', notionUrl: 'https://www.notion.so/a', genre: ['救急', '循環'] },
  { objectID: 'b', source: 'medical', knowledgeLevel: '📋 まとめ', title: 'まとめ題', createdAt: '2026-07-04T00:00:00.000Z', notionUrl: 'https://www.notion.so/b' },
  { objectID: 'c', source: 'reference', title: '文献題', createdAt: '2026-07-01T00:00:00.000Z', notionUrl: 'https://www.notion.so/c' },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TAIJU_KEY = 'premium-key'
  process.env.SUBSCRIPTION_ALGOLIA_APP_ID = 'app'
  process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY = 'key'
  searchMock.mockResolvedValue({ hits: HITS })
})

describe('/api/garden/taiju', () => {
  it('無印はteaser: countsは4キー・blossomsにtitle/urlが無い・降順', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({ cq: 0, knowledge: 1, matome: 1, reference: 1 })
    expect(body.blossoms.map((b: { kind: string }) => b.kind)).toEqual(['matome', 'knowledge', 'reference'])
    expect(body.blossoms[1]).toEqual({ kind: 'knowledge', date: '2026-07-03T00:00:00.000Z', genre: '救急' })
    expect('title' in body.blossoms[0]).toBe(false)
    expect('url' in body.blossoms[0]).toBe(false)
  })
  it('key一致でtitle/urlが加わる', async () => {
    const body = await (await GET(req('premium-key'))).json()
    expect(body.blossoms[1].title).toBe('秘密の題')
    expect(body.blossoms[1].url).toBe('https://www.notion.so/a')
  })
  it('key不一致はteaser扱い（404にしない・titleは漏らさない）', async () => {
    const res = await GET(req('wrong-key'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect('title' in body.blossoms[0]).toBe(false)
  })
  it('TAIJU_KEY未設定なら全員teaser', async () => {
    delete process.env.TAIJU_KEY
    const body = await (await GET(req('premium-key'))).json()
    expect('title' in body.blossoms[0]).toBe(false)
  })
  it('障害時は空teaserに劣化', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchMock.mockRejectedValue(new Error('down'))
    const body = await (await GET(req())).json()
    expect(body).toEqual({ counts: { cq: 0, knowledge: 0, matome: 0, reference: 0 }, blossoms: [] })
    spy.mockRestore()
  })
})
