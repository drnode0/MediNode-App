import { describe, it, expect, vi, beforeEach } from 'vitest'

// 2026-09-05 提案006の裁定5。段0の「残す」ボタン・着地画面と keep の呼び手が増えるため、
// keep:true の入口で「実在して active な主張か」を締める。recall_claims は RLS ポリシーが
// 無く service_role のみが読めるので、g.admin() 経由で読んでいることも合わせて確認する
// （recall-read-routes.test.ts と同じく、admin/user のどちらのクライアントで・どのテーブルを・
// どの条件で読んだかを記録するモックにする。引数を捨てるモックだと g.supabase で読んでも
// 緑のままになり、RLS 未対応のテーブルにユーザースコープで触れる退行を検知できない）。

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
let claimsRows: Record<string, unknown> | null = null
let progressRow: Record<string, unknown> | null = null

type Query = { client: 'admin' | 'user'; table: string; eq: [string, unknown][] }
let queries: Query[] = []
let writes: Array<{ table: string; row: Record<string, unknown>; opts?: Record<string, unknown> }> = []

function makeFrom(client: 'admin' | 'user') {
  return (table: string) => {
    const call: Query = { client, table, eq: [] }
    queries.push(call)
    const q = {
      eq: (column: string, value: unknown) => { call.eq.push([column, value]); return q },
      maybeSingle: async () => {
        if (table === 'recall_claims') return { data: claimsRows, error: null }
        if (table === 'recall_progress') return { data: progressRow, error: null }
        return { data: null, error: null }
      },
    }
    return {
      select: () => q,
      upsert: async (row: Record<string, unknown>, opts?: Record<string, unknown>) => {
        writes.push({ table, row, opts })
        return { error: null }
      },
    }
  }
}

const adminFrom = vi.fn(makeFrom('admin'))
const userFrom = vi.fn(makeFrom('user'))

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: userFrom }),
  createAdminClient: () => ({ from: adminFrom }),
}))

const { POST: keepPOST } = await import('../../app/api/recall/keep/route')
const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const queriesOn = (table: string) => queries.filter((q) => q.table === table)

beforeEach(() => {
  sessionHasFeature.mockReset().mockResolvedValue(true)
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  adminFrom.mockClear()
  userFrom.mockClear()
  claimsRows = null
  progressRow = null
  queries = []
  writes = []
})

describe('/api/recall/keep の keep:true 存在確認', () => {
  it('recall_claims に行が無ければ 404（記録には一切触れない）', async () => {
    claimsRows = null
    const res = await keepPOST(req({ claimId: 'a', keep: true }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    // recall_progress へは読み書きどちらもしていない（存在確認が先に締める）。
    expect(queriesOn('recall_progress')).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('recall_claims の active が false なら 404（取り下げ済みを出題母集団に戻さない）', async () => {
    claimsRows = { claim_id: 'a', active: false }
    const res = await keepPOST(req({ claimId: 'a', keep: true }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(writes).toHaveLength(0)
  })

  it('active が null・欠落など true 以外は同じく 404（出さない側に倒す）', async () => {
    for (const active of [null, undefined, 'true', 1]) {
      writes = []; queries = []
      claimsRows = { claim_id: 'a', active }
      const res = await keepPOST(req({ claimId: 'a', keep: true }))
      expect(res.status, `active=${JSON.stringify(active)}`).toBe(404)
    }
  })

  it('recall_claims の active が true なら従来どおり 200・g.admin() で recall_claims を読む', async () => {
    claimsRows = { claim_id: 'a', active: true }
    progressRow = null
    const res = await keepPOST(req({ claimId: 'a', keep: true }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.progress).toMatchObject({ claimId: 'a', intervalDays: 1, removedAt: null })
    // 存在確認は service_role（admin）クライアントで、当該 claim_id に絞って読む。
    expect(adminFrom).toHaveBeenCalledWith('recall_claims')
    expect(queriesOn('recall_claims')).toHaveLength(1)
    expect(queriesOn('recall_claims')[0].client).toBe('admin')
    expect(queriesOn('recall_claims')[0].eq).toEqual([['claim_id', 'a']])
    // 記録の読み書きは本人スコープのまま（ユーザークライアント）。
    expect(writes[0].table).toBe('recall_progress')
    // 応答形・キャッシュヘッダは変えない。
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('既存の外し済み記録を復活させる経路も、主張が inactive なら 404 にする（復活させない）', async () => {
    claimsRows = { claim_id: 'a', active: false }
    progressRow = { claim_id: 'a', kept_at: 'k', streak: 3, interval_days: 14, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 3, ng_count: 0, removed_at: 'x' }
    const res = await keepPOST(req({ claimId: 'a', keep: true }))
    expect(res.status).toBe(404)
    // 存在確認で止まるので、記録の読み書きは一切起きない（復活しない）。
    expect(queriesOn('recall_progress')).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('keep:false（外す）は主張の存在確認をしない。inactive・存在しない主張でも記録があれば外せる', async () => {
    claimsRows = null // recall_claims に行が無い・inactive でも keep:false は通す
    progressRow = { claim_id: 'a', kept_at: 'k', streak: 1, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }
    const res = await keepPOST(req({ claimId: 'a', keep: false }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.progress.removedAt).toBeTruthy()
    // keep:false では recall_claims に一切触れない（admin クライアントも呼ばれない）。
    expect(adminFrom).not.toHaveBeenCalled()
    expect(queriesOn('recall_claims')).toHaveLength(0)
  })

  it('keep:false で記録が無ければ従来どおり404（recall_claims には触れない）', async () => {
    claimsRows = { claim_id: 'a', active: true }
    progressRow = null
    const res = await keepPOST(req({ claimId: 'a', keep: false }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(adminFrom).not.toHaveBeenCalled()
  })
})
