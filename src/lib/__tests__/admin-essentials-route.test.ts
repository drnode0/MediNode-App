import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { requireAdminMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))

import { GET } from '../../app/api/admin/essentials/route'

const req = (refresh = true) => new Request(`http://localhost/api/admin/essentials${refresh ? '?refresh=1' : ''}`)

const ENV_KEYS = ['ESSENTIALS_NOTION_DB', 'ESSENTIALS_SOURCES_NOTION_DB', 'SUBSCRIPTION_NOTION_TOKEN'] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function notionPage(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, url: `https://www.notion.so/${id}`, properties: { 名前: { title: [{ plain_text: name }] }, ...extra } }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.ESSENTIALS_NOTION_DB = 'topicsdb'
  process.env.ESSENTIALS_SOURCES_NOTION_DB = 'sourcesdb'
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

describe('GET /api/admin/essentials', () => {
  it('管理者でなければガードの応答をそのまま返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('環境変数が無ければ ready:false と足りない名前を返す（200）', async () => {
    delete process.env.ESSENTIALS_NOTION_DB
    delete process.env.ESSENTIALS_SOURCES_NOTION_DB
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ready: false,
      reason: 'not_configured',
      missing: ['ESSENTIALS_NOTION_DB', 'ESSENTIALS_SOURCES_NOTION_DB'],
    })
  })

  it('DBが連携に共有されていなければ not_shared と Notion のURLを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    )
    const res = await GET(req())
    const body = await res.json()
    expect(body).toEqual({
      ready: false,
      reason: 'not_shared',
      topicsDbUrl: 'https://www.notion.so/topicsdb',
      sourcesDbUrl: 'https://www.notion.so/sourcesdb',
    })
  })

  it('両DBを読んで主題と出典を返し、5分以内の再読み込みは Notion を叩かない', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const isTopics = String(url).includes('/databases/topicsdb/')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: isTopics
            ? [notionPage('t1', '敗血症', { 段階: { select: { name: '6 サブスク移行済' } }, 領域: { select: { name: '感染症' } } })]
            : [notionPage('s1', 'SSC 2021', { 状態: { select: { name: '全文' } }, 主題: { relation: [{ id: 't1' }] } })],
          has_more: false,
          next_cursor: null,
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(req())
    const body = await res.json()
    expect(body.ready).toBe(true)
    expect(body.topics).toHaveLength(1)
    expect(body.topics[0]).toMatchObject({ id: 't1', name: '敗血症', stage: '6 サブスク移行済', area: '感染症' })
    expect(body.sources[0]).toMatchObject({ id: 's1', name: 'SSC 2021', state: '全文', topicIds: ['t1'] })
    expect(body.topicsDbUrl).toBe('https://www.notion.so/topicsdb')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // refresh 無しの2回目はキャッシュから返る
    const res2 = await GET(req(false))
    expect((await res2.json()).fetchedAt).toBe(body.fetchedAt)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Notion のHTTPエラーは fetch_failed と理由を返し、キャッシュしない', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await GET(req())
    expect(await res.json()).toEqual({ ready: false, reason: 'fetch_failed', detail: 'http_error (500), http_error (500)' })
  })
})
