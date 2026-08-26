import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, listMock, guardMock, maybeSingleMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(), listMock: vi.fn(), guardMock: vi.fn(), maybeSingleMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: retrieveMock }; blocks = { children: { list: listMock } } },
}))
// spread_doc（誌面の保存データ）は未目視の設問を含んだまま保存される。
// /admin はそれをそのまま読むが、サブスク公開側のこのルートは reviewed: true だけに絞って
// 返す必要がある（関門はサーバー側にも要る）。ここではSupabaseをチェーン可能なモックにする。
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }) }),
  }),
}))
// ルートは認証と権限を requirePremiumRequest の1回で判定する（getUser の往復を減らすため）。
// ガード自体の挙動は api-guard-premium.test.ts が受け持つ。ここは通す／弾くだけを差し替える。
vi.mock('@/lib/api-guard', () => ({ requirePremiumRequest: guardMock }))
const allow = () => guardMock.mockResolvedValue({ denied: null, userId: 'u1', email: 'a@x.test' })
const deny = (status: number) =>
  guardMock.mockResolvedValue({ denied: NextResponse.json({ error: 'x' }, { status }), userId: null })
// テスト環境にはNextのincremental cache実体がないため、unstable_cacheは素通しにする
// （キャッシュ層の有無に依らずルートのロジックを検証する）。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

import { GET } from '../../app/api/subscription/page/route'
import { NextRequest, NextResponse } from 'next/server'

const req = (id?: string) =>
  new NextRequest(`http://localhost/api/subscription/page${id != null ? `?id=${id}` : ''}`)

beforeEach(() => {
  retrieveMock.mockReset(); listMock.mockReset(); guardMock.mockReset(); maybeSingleMock.mockReset()
  allow()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'ntn_test'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  maybeSingleMock.mockResolvedValue({ data: null })
})

describe('GET /api/subscription/page', () => {
  it('id 未指定は 400', async () => {
    allow()
    const res = await GET(req())
    expect(res.status).toBe(400)
  })

  it('非会員は 403（本文を取得しない）', async () => {
    deny(403)
    const res = await GET(req('abc123'))
    expect(res.status).toBe(403)
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('会員は 200 で doc を返し subscription_ 接頭辞を剥がす', async () => {
    allow()
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({
      results: [{ id: 'b1', type: 'heading_2', has_children: false, heading_2: { rich_text: [{ plain_text: 'H', annotations: {} }] } }],
      has_more: false, next_cursor: null,
    })
    const res = await GET(req('subscription_PAGEID'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
    expect(data.doc.title).toBe('T')
    expect(data.doc.blocks[0]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: 'H' }], blockId: 'b1' })
    expect(res.headers.get('Cache-Control')).toContain('max-age=600')
  })

  it('会員は 200 で doc を返し #secN サフィックスも剥がす（節objectIDが渡った場合の保険）', async () => {
    allow()
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
    const res = await GET(req('subscription_PAGEID#sec3'))
    expect(res.status).toBe(200)
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
  })

  it('トークン未設定は 500', async () => {
    allow()
    delete process.env.SUBSCRIPTION_NOTION_TOKEN
    const res = await GET(req('abc'))
    expect(res.status).toBe(500)
  })

  it('spread は目視前（reviewed: false）の設問を除いて返す（保存データ自体は変えない）', async () => {
    allow()
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
    const spreadDoc = {
      version: 1, pageId: 'PAGEID', title: 'T', lead: null, preface: [], sections: [], tail: [],
      icons: {},
      quizzes: [
        { id: 'q1', sectionAnchor: '1', question: 'reviewed済み', choices: ['a', 'b'], answerIndex: 0, evidence: 'x', reviewed: true },
        { id: 'q2', sectionAnchor: '1', question: '未目視', choices: ['a', 'b'], answerIndex: 0, evidence: 'y', reviewed: false },
      ],
    }
    maybeSingleMock.mockResolvedValue({ data: { spread_doc: spreadDoc } })
    const res = await GET(req('PAGEID'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.spread.quizzes).toHaveLength(1)
    expect(data.spread.quizzes[0].id).toBe('q1')
  })
})
