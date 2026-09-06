import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  feature: true,
  user: { id: 'u1', email: 'owner@example.com' } as { id: string; email: string } | null,
  logRow: { id: 7, query: 'ショックの見分け方' } as { id: number; query: string } | null,
  claims: [] as Record<string, unknown>[],
  todayCount: 0,
  updated: [] as Record<string, unknown>[],
  call: { verdict: 'ok', output: { groups: [{ heading: 'まず読む', claimIds: ['c1', 'c2'] }], notCovered: ['数値は棚にありません'] }, model: 'claude-opus-5', inputTokens: 2400, outputTokens: 900, retried: false } as Record<string, unknown>,
}

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {
        // select は必ずビルダーを返す。head:true でも Promise を返すと
        // 続く .eq().gte() が繋がらなくなる。件数は終端の gte が返す。
        select: () => q,
        eq: () => q,
        gte: async () => ({ count: state.todayCount, error: null }),
        is: async () => ({ data: [], error: null }),
        limit: async () => ({ data: table === 'recall_claims' ? state.claims : [], error: null }),
        maybeSingle: async () => ({ data: state.logRow, error: null }),
        update: (v: Record<string, unknown>) => { state.updated.push(v); return { eq: () => ({ eq: async () => ({ error: null }) }) } },
      }
      return q
    },
  }),
}))
vi.mock('@/lib/ask-shelf/stage1-call', () => ({ callStage1: async () => state.call }))

const { POST } = await import('@/app/api/ask-shelf/stage1/route')
const call = (body: unknown) =>
  POST(new Request('http://x/api/ask-shelf/stage1', { method: 'POST', body: JSON.stringify(body) }))

const row = (id: string, body: string) => ({
  claim_id: id, page_id: 'p1', page_title: 'ショックの見方', section_key: 'sec1',
  section_heading: '見出し', body, source: 'ESICM 2014', confidence: 'ok', keywords: 'ショック', active: true,
})

beforeEach(() => {
  state.feature = true
  state.user = { id: 'u1', email: 'owner@example.com' }
  state.logRow = { id: 7, query: 'ショックの見分け方' }
  state.todayCount = 0
  state.updated = []
  // テストの実行順に結果が左右されないよう、呼び出しの返り値も毎回戻す。
  state.call = { verdict: 'ok', output: { groups: [{ heading: 'まず読む', claimIds: ['c1', 'c2'] }], notCovered: ['数値は棚にありません'] }, model: 'claude-opus-5', inputTokens: 2400, outputTokens: 900, retried: false }
  state.claims = [row('c1', 'ショックの見分け方は低血圧では決まらない'), row('c2', 'ショックの見分け方に乳酸値を使う')]
})

describe('POST /api/ask-shelf/stage1', () => {
  it('フラグが閉じていれば本文なしの404', async () => {
    state.feature = false
    const res = await call({ logId: 7 })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('未ログインなら401', async () => {
    state.user = null
    expect((await call({ logId: 7 })).status).toBe(401)
  })

  it('logId が無ければ400', async () => {
    expect((await call({})).status).toBe(400)
  })

  it('自分の記録が見つからなければ404(他人の logId を渡されても問いを読ませない)', async () => {
    state.logRow = null
    expect((await call({ logId: 7 })).status).toBe(404)
  })

  it('主張が1件しか引けないなら400(整理する対象が無い)', async () => {
    state.claims = [row('c1', 'ショックの見分け方は低血圧では決まらない')]
    expect((await call({ logId: 7 })).status).toBe(400)
  })

  it('本日の上限に達していたら429。呼び出しの記録も書かない', async () => {
    state.todayCount = 20
    const res = await call({ logId: 7 })
    expect(res.status).toBe(429)
    expect((await res.json()).notice).toBe('本日の整理は上限に達しました。')
    expect(state.updated).toEqual([])
  })

  it('通れば並びと列挙を返す。主張の本文は返さない', async () => {
    const res = await call({ logId: 7 })
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.groups[0].claimIds).toEqual(['c1', 'c2'])
    expect(j.notCovered).toEqual(['数値は棚にありません'])
    expect(JSON.stringify(j)).not.toContain('低血圧では決まらない')
  })

  it('記録の列を全部書く。見出しと列挙の本文は書かない', async () => {
    await call({ logId: 7 })
    const u = state.updated[0]
    expect(u.stage1_model).toBe('claude-opus-5')
    expect(u.stage1_verdict).toBe('ok')
    expect(u.stage1_claim_ids).toEqual(['c1', 'c2'])
    expect(u.stage1_input_tokens).toBe(2400)
    expect(u.stage1_output_tokens).toBe(900)
    expect(u.stage1_retried).toBe(false)
    expect(typeof u.stage1_ms).toBe('number')
    expect(typeof u.stage1_at).toBe('string')
    expect(JSON.stringify(u)).not.toContain('まず読む')
    expect(JSON.stringify(u)).not.toContain('数値は棚にありません')
  })

  it('形式検証に落ちた回は ok:false を返し、落ちた分類を記録する', async () => {
    state.call = { ...state.call, verdict: 'rejected_vocab', output: null }
    const res = await call({ logId: 7 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(state.updated[0].stage1_verdict).toBe('rejected_vocab')
  })

  it('残り1回になるときだけ案内を乗せる', async () => {
    state.call = { verdict: 'ok', output: { groups: [{ heading: 'まず読む', claimIds: ['c1', 'c2'] }], notCovered: [] }, model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, retried: false }
    state.todayCount = 18
    expect((await (await call({ logId: 7 })).json()).notice).toBe('本日お使いいただける整理は、あと1回です。')
    state.todayCount = 17
    expect((await (await call({ logId: 7 })).json()).notice).toBeNull()
  })

  it('GET は404', async () => {
    const mod = await import('@/app/api/ask-shelf/stage1/route')
    expect((await mod.GET()).status).toBe(404)
  })
})
