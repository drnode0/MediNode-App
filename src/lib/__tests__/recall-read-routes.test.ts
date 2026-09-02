import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
let rows: Record<string, unknown[]> = {}
let tableErrors: Record<string, { message: string }> = {}

// どのクライアントが・どのテーブルを・どの条件で引いたかを記録する。
// 引数を捨てるモックだと `.eq('active', true)` や `.eq('user_id', ...)` を消しても緑のままになり、
// ポリシーの代わりにコードが担っている絞り込みの消失を検知できない。
type Query = { client: 'admin' | 'user'; table: string; eq: [string, unknown][] }
let queries: Query[] = []

function makeFrom(client: 'admin' | 'user') {
  return (table: string) => {
    const call: Query = { client, table, eq: [] }
    queries.push(call)
    const q = {
      eq: (column: string, value: unknown) => { call.eq.push([column, value]); return q },
      is: () => q,
      order: () => q,
      then: (res: (v: unknown) => void) => {
        const error = tableErrors[table]
        res(error ? { data: null, error } : { data: rows[table] ?? [], error: null })
      },
    }
    return { select: () => q }
  }
}

// recall_claims は RLS ポリシーを持たない（service_role のみが読める）。
// そのため claims ルートはガード経由で受け取った service_role の客体で読む。
// 本人の記録（progress）が service_role に触れないことを言えるよう、2つを別々にモックする。
const adminFrom = vi.fn(makeFrom('admin'))
const userFrom = vi.fn(makeFrom('user'))

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: userFrom }),
  createAdminClient: () => ({ from: adminFrom }),
}))

const claimsRoute = await import('../../app/api/recall/claims/route')
const progressRoute = await import('../../app/api/recall/progress/route')
const claimsGET = claimsRoute.GET
const progressGET = progressRoute.GET

const queriesOn = (table: string) => queries.filter((q) => q.table === table)

beforeEach(() => {
  sessionHasFeature.mockReset()
  getUser.mockReset()
  adminFrom.mockClear()
  userFrom.mockClear()
  rows = {}
  tableErrors = {}
  queries = []
})

describe('Recall 読み取りルート', () => {
  it('機能が閉じていれば 404（存在を見せない・どちらのクライアントもテーブルに触れない）', async () => {
    sessionHasFeature.mockResolvedValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    expect((await claimsGET()).status).toBe(404)
    expect((await progressGET()).status).toBe(404)
    // ガードで弾かれた時点で、service_role の主張コーパスにも本人の記録にも一切触れていない。
    expect(adminFrom).not.toHaveBeenCalled()
    expect(userFrom).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })

  it('404 は理由を書いた本文を返さない（存在しない経路との差を作らない）', async () => {
    sessionHasFeature.mockResolvedValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    for (const res of [await claimsGET(), await progressGET()]) {
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('')
    }
  })

  it('GET 以外のメソッドも同じ 404 で塞ぐ（Next の自動実装に渡さない）', async () => {
    // 実装しないと Next が OPTIONS に 204+Allow、他に 405 を返し、ガードを通さないまま
    // 「この経路は存在する」と教えてしまう。
    for (const mod of [claimsRoute, progressRoute]) {
      for (const method of ['HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const handler = (mod as unknown as Record<string, undefined | (() => Response)>)[method]
        expect(handler, `${method} が未実装`).toBeTypeOf('function')
        const res = handler!()
        expect(res.status, `${method} の状態コード`).toBe(404)
        expect(await res.text()).toBe('')
      }
    }
  })

  it('未ログインは 401（どちらのクライアントもテーブルに触れない）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await claimsGET()).status).toBe(401)
    expect((await progressGET()).status).toBe(401)
    expect(adminFrom).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })

  it('主張は camelCase で返す（service_role クライアントで・取り下げ分を除いて読む）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_claims = [{ claim_id: 'a', page_id: 'p', page_title: 't', page_kind: '💡', section_key: 'sec1', section_heading: 'h', body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primary_genre: '05.循環', genre_slot: 4, holes: [[0, 2]], cloze_status: 'approved', active: true }]
    const res = await claimsGET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.claims[0]).toMatchObject({ claimId: 'a', genreSlot: 4, holes: [[0, 2]], clozeStatus: 'approved', active: true })
    // 主張コーパスは user-scoped ではなく admin（service_role）で読んでいること。
    expect(adminFrom).toHaveBeenCalledWith('recall_claims')
    expect(userFrom).not.toHaveBeenCalled()
    // 取り下げた主張を出さない絞り込み。ポリシーが無い今、このコードだけが担っている。
    expect(queriesOn('recall_claims')).toHaveLength(1)
    expect(queriesOn('recall_claims')[0].client).toBe('admin')
    expect(queriesOn('recall_claims')[0].eq).toContainEqual(['active', true])
  })

  it('active が真でない行は取り下げ扱いにする（null・欠落でも出さない側へ倒す）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const base = { claim_id: 'a', page_id: 'p', body: 'b' }
    rows.recall_claims = [{ ...base, active: null }, { ...base, claim_id: 'b' }, { ...base, claim_id: 'c', active: 'true' }]
    const json = await (await claimsGET()).json()
    expect(json.claims.map((c: { active: boolean }) => c.active)).toEqual([false, false, false])
  })

  it('主張の読み取りが失敗したら 500（生のDBメッセージは返さない）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    tableErrors.recall_claims = { message: 'relation "recall_claims" does not exist' }
    const res = await claimsGET()
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('recall_claims')
  })

  it('記録は本人分だけを camelCase で返す（ユーザースコープのクライアントで読む）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_progress = [{ claim_id: 'a', kept_at: 'k', streak: 1, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }]
    rows.recall_section_reads = [{ page_id: 'p', section_key: 'sec1', read_at: 'r' }]
    const res = await progressGET()
    const json = await res.json()
    expect(json.progress[0]).toMatchObject({ claimId: 'a', intervalDays: 3, removedAt: null })
    expect(json.reads[0]).toEqual({ pageId: 'p', sectionKey: 'sec1', readAt: 'r' })
    // 本人の記録は admin クライアントを使わない（RLS 下のユーザースコープで読む）。
    expect(adminFrom).not.toHaveBeenCalled()
    // 2つのクエリとも本人の user_id で絞っていること。
    for (const table of ['recall_progress', 'recall_section_reads']) {
      expect(queriesOn(table)).toHaveLength(1)
      expect(queriesOn(table)[0].client).toBe('user')
      expect(queriesOn(table)[0].eq).toContainEqual(['user_id', 'u1'])
    }
    // 1人分の記録はどの層にも残させない。
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('記録の読み取りが失敗したら 500（生のDBメッセージは返さない）', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    tableErrors.recall_progress = { message: 'permission denied for table recall_progress' }
    const p = await progressGET()
    expect(p.status).toBe(500)
    expect(await p.text()).not.toContain('permission denied')

    tableErrors = { recall_section_reads: { message: 'permission denied for table recall_section_reads' } }
    const r = await progressGET()
    expect(r.status).toBe(500)
    expect(await r.text()).not.toContain('permission denied')
  })
})
