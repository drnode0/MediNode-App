import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  feature: true,
  user: { id: 'u1', email: 'owner@example.com' } as { id: string; email: string } | null,
  claims: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
}

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from(table: string) {
      const rows = table === 'recall_claims' ? state.claims : state.progress
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: async () => ({ data: rows, error: null }),
        limit: async () => ({ data: rows, error: null }),
        insert: (v: Record<string, unknown>) => {
          state.inserted.push(v)
          return { select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }
        },
      }
      return q
    },
  }),
}))
// 層2・層3は別経路。ここでは段0の骨だけを見る。
vi.mock('@/lib/ask-shelf/sources', () => ({ fetchSections: async () => [], fetchBoardItems: async () => [] }))

const { POST } = await import('@/app/api/ask-shelf/search/route')
const call = (body: unknown) =>
  POST(new Request('http://x/api/ask-shelf/search', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.feature = true
  state.user = { id: 'u1', email: 'owner@example.com' }
  state.inserted = []
  state.progress = []
  state.claims = [{
    claim_id: 'c1', page_id: 'p1', page_title: '💡 ショックの問い', section_key: 'sec1',
    section_heading: '1. 低血圧は要件ではない', body: '低血圧はショックの定義の要件ではない',
    source: 'ESICM 2014', confidence: 'ok', keywords: 'ショック', active: true,
  }]
})

describe('POST /api/ask-shelf/search', () => {
  it('フラグが閉じていれば本文なしの404（機能の存在を見せない）', async () => {
    state.feature = false
    const res = await call({ query: 'ショック' })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('未ログインなら401', async () => {
    state.user = null
    expect((await call({ query: 'ショック' })).status).toBe(401)
  })

  it('棚にある問いは主張を返す', async () => {
    const json = await (await call({ query: '低血圧はショックの定義の要件ではない' })).json()
    expect(json.claims[0].claim.claimId).toBe('c1')
    expect(json.emptyMessage).toBeNull()
  })

  it('棚に無い問いは決まった1行を返す', async () => {
    const json = await (await call({ query: '白内障手術後の眼圧上昇' })).json()
    expect(json.claims).toEqual([])
    expect(json.emptyMessage).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
  })

  it('問いが長すぎるときは400（上限は投稿フォームと同じ1000字）', async () => {
    expect((await call({ query: 'あ'.repeat(1001) })).status).toBe(400)
  })

  it('段0を出した回を記録する（送らずに済んだ割合を測るため）', async () => {
    await call({ query: '低血圧はショックの定義の要件ではない' })
    expect(state.inserted.length).toBe(1)
    expect(state.inserted[0].submitted).toBe(false)
  })

  // /admin の候補検索は同じこのAPIを流用している。記録まで同じにすると、
  // 同じ画面に出している「送らずに済んだ割合」を作者のトリアージが膨らませる。
  it('log:false の呼び出しは記録しない（/admin の候補検索が割合を濁さない）', async () => {
    const json = await (await call({ query: '低血圧はショックの定義の要件ではない', log: false })).json()
    expect(state.inserted).toEqual([])
    expect(json.logId).toBeNull()
    // 記録しないだけで、結果そのものは読者側と同じものを返す。
    expect(json.claims[0].claim.claimId).toBe('c1')
  })
})
