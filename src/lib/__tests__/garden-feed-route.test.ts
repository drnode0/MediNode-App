import { describe, it, expect, vi, beforeEach } from 'vitest'

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))
vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => ({ search: searchMock }) }),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => true),
  clientIp: () => '127.0.0.1',
}))

import { GET } from '../../app/api/garden/feed/route'

const req = (token?: string, origin?: string) =>
  new Request(`http://localhost/api/garden/feed${token !== undefined ? `?token=${token}` : ''}`, {
    headers: origin ? { origin } : {},
  })

const HITS = [
  { objectID: 'a', source: 'medical', knowledgeLevel: '❓ CQ', title: '古いCQ', createdAt: '2026-07-01T00:00:00.000Z', notionUrl: 'https://www.notion.so/a', genre: ['救急'] },
  { objectID: 'b', source: 'medical', knowledgeLevel: '💡 ナレッジ', title: 'ナレッジ', createdAt: '2026-07-03T00:00:00.000Z', notionUrl: 'https://www.notion.so/b', genre: [] },
  { objectID: 'c', source: 'reference', title: '文献', createdAt: '2026-07-02T00:00:00.000Z', notionUrl: 'https://www.notion.so/c' },
  { objectID: 'd', source: 'medical', knowledgeLevel: '📋 まとめ', title: 'まとめ', createdAt: '2026-07-04T00:00:00.000Z', notionUrl: 'https://www.notion.so/d' },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GARDEN_TOKEN = 'secret-token'
  process.env.SUBSCRIPTION_ALGOLIA_APP_ID = 'app'
  process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY = 'key'
  searchMock.mockResolvedValue({ hits: HITS })
})

describe('/api/garden/feed', () => {
  it('token一致: createdAt昇順のevents＋counts（matomeはcountsに入らない）', async () => {
    const res = await GET(req('secret-token', 'https://chi-no-niwa.vercel.app'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(body.events[0]).toEqual({ id: 'a', kind: 'cq', title: '古いCQ', date: '2026-07-01T00:00:00.000Z', url: 'https://www.notion.so/a' })
    expect(body.events[2].kind).toBe('knowledge')
    expect(body.events[3].kind).toBe('matome')
    expect(body.counts).toEqual({ cq: 1, knowledge: 1, reference: 1 })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://chi-no-niwa.vercel.app')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300')
  })
  it('token不一致・欠落・env未設定は404（理由は言わない）', async () => {
    expect((await GET(req('wrong'))).status).toBe(404)
    expect((await GET(req())).status).toBe(404)
    delete process.env.GARDEN_TOKEN
    expect((await GET(req('secret-token'))).status).toBe(404)
  })
  it('Algolia障害は空データ200に劣化（庭は前回のまま黙る）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchMock.mockRejectedValue(new Error('down'))
    const res = await GET(req('secret-token'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ events: [], counts: { cq: 0, knowledge: 0, reference: 0 } })
    spy.mockRestore()
  })
  it('直近200件に切る（昇順の末尾200）', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      objectID: `id${i}`, source: 'medical', knowledgeLevel: '❓ CQ', title: `t${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(), notionUrl: '',
    }))
    searchMock.mockResolvedValue({ hits: many })
    const body = await (await GET(req('secret-token'))).json()
    expect(body.events).toHaveLength(200)
    expect(body.events[0].id).toBe('id50')
    expect(body.events[199].id).toBe('id249')
    expect(body.counts.cq).toBe(250) // countsは全件から数える
  })
})
