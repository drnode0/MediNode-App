import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  user: { id: 'u1' } as { id: string } | null,
  page: null as Record<string, unknown> | null,
  claims: [] as Record<string, unknown>[],
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: state.claims, error: null }), limit: async () => ({ data: state.claims, error: null }) }) }) }),
  }),
}))
vi.mock('@/lib/notion-intake', () => ({ getIntakePage: async () => state.page }))

const { GET } = await import('@/app/api/ask-shelf/answered/[id]/route')
const call = (id: string) => GET(new Request('http://x'), { params: Promise.resolve({ id }) })

const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })
beforeEach(() => {
  state.user = { id: 'u1' }
  state.claims = [{ claim_id: 'c9', page_id: 'p1', page_title: '💡 ショックの問い', section_key: 'sec3', section_heading: '3. 判定', body: '乳酸値2 mmol/L超を目安にする', source: 'ESICM 2014', confidence: 'ok' }]
  state.page = {
    id: 'i1',
    properties: {
      疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
      通知先ユーザーID: rich('u1'),
      対応状態: { select: { name: '対応済み' } },
      正本主張ID: rich('c9'),
    },
  }
})

describe('GET /api/ask-shelf/answered/[id]', () => {
  it('本人には疑問と回答を返す', async () => {
    const json = await (await call('i1')).json()
    expect(json.question).toBe('ショックの見分け方は？')
    expect(json.answer.claimId).toBe('c9')
    expect(json.answer.source).toBe('ESICM 2014')
  })
  it('他人には404（1文字も返さない）', async () => {
    state.user = { id: 'u2' }
    const res = await call('i1')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
  it('未ログインは401', async () => {
    state.user = null
    expect((await call('i1')).status).toBe(401)
  })
  it('正本主張IDが無ければ answer は null（画面は疑問と状態だけ出す）', async () => {
    ;(state.page!.properties as Record<string, unknown>)['正本主張ID'] = rich('')
    const json = await (await call('i1')).json()
    expect(json.answer).toBeNull()
  })
})
