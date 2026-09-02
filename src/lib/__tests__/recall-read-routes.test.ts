import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
let rows: Record<string, unknown[]> = {}

// recall_claims は RLS ポリシーを持たない（service_role のみが読める）。
// そのため claims ルートは createAdminClient() で読む。ここでは createClient と
// 呼び出し検証つきで区別できるよう別々にモックする。
const adminFrom = vi.fn((table: string) => {
  const q = { eq: () => q, is: () => q, order: () => q, then: undefined as unknown }
  return { select: () => Object.assign(q, { then: (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null }) }) }
})

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const q = { eq: () => q, is: () => q, order: () => q, then: undefined as unknown }
      return { select: () => Object.assign(q, { then: (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null }) }) }
    },
  }),
  createAdminClient: () => ({ from: adminFrom }),
}))

const { GET: claimsGET } = await import('../../app/api/recall/claims/route')
const { GET: progressGET } = await import('../../app/api/recall/progress/route')

beforeEach(() => {
  sessionHasFeature.mockReset()
  getUser.mockReset()
  adminFrom.mockClear()
  rows = {}
})

describe('Recall 読み取りルート', () => {
  it('機能が閉じていれば 404（存在を見せない・主張コーパスにも触れない）', async () => {
    sessionHasFeature.mockResolvedValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    expect((await claimsGET()).status).toBe(404)
    expect((await progressGET()).status).toBe(404)
    // ガードで弾かれた時点で、service_role の主張コーパスに一切触れていないことを保証する。
    expect(adminFrom).not.toHaveBeenCalled()
  })

  it('未ログインは 401', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await claimsGET()).status).toBe(401)
    expect(adminFrom).not.toHaveBeenCalled()
  })

  it('主張は camelCase で返す（service_role クライアントで読む）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_claims = [{ claim_id: 'a', page_id: 'p', page_title: 't', page_kind: '💡', section_key: 'sec1', section_heading: 'h', body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primary_genre: '05.循環', genre_slot: 4, holes: [[0, 2]], cloze_status: 'approved', active: true }]
    const res = await claimsGET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.claims[0]).toMatchObject({ claimId: 'a', genreSlot: 4, holes: [[0, 2]], clozeStatus: 'approved' })
    // 主張コーパスは user-scoped ではなく admin（service_role）で読んでいること。
    expect(adminFrom).toHaveBeenCalledWith('recall_claims')
  })

  it('記録は本人分だけを camelCase で返す（ユーザースコープのクライアントで読む）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_progress = [{ claim_id: 'a', kept_at: 'k', streak: 1, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }]
    rows.recall_section_reads = [{ page_id: 'p', section_key: 'sec1', read_at: 'r' }]
    const json = await (await progressGET()).json()
    expect(json.progress[0]).toMatchObject({ claimId: 'a', intervalDays: 3, removedAt: null })
    expect(json.reads[0]).toEqual({ pageId: 'p', sectionKey: 'sec1', readAt: 'r' })
    // 本人の記録は admin クライアントを使わない（RLS 下のユーザースコープで読む）。
    expect(adminFrom).not.toHaveBeenCalled()
  })
})
