import { describe, it, expect, vi, beforeEach } from 'vitest'

// 本文は10文字。範囲の検査は「本文の長さ」で行うので、テストでも実物と同じ条件にする。
const BODY = 'ABCDEFGHIJ'

const requireAdmin = vi.fn()
const logAdminAction = vi.fn(async () => {})
// テーブル名・絞り込みを観測する。ここを見ないと、別テーブルへ書いても
// .eq('claim_id', …) を落として全行を更新しても、テストは通ってしまう。
let tables: string[] = []
let updatePatches: unknown[] = []
let updateEqs: unknown[][] = []
let selectEqs: unknown[][] = []
let rows: unknown[] = []
let bodyRow: { body: string } | null = { body: BODY }

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: (...a: unknown[]) => logAdminAction(...(a as [])) }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      tables.push(table)
      return {
        update: (patch: unknown) => {
          updatePatches.push(patch)
          const b: Record<string, unknown> = {}
          b.eq = (...a: unknown[]) => { updateEqs.push(a); return b }
          b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ error: null }))
          return b
        },
        select: () => {
          const q: Record<string, unknown> = {}
          q.eq = (...a: unknown[]) => { selectEqs.push(a); return q }
          q.order = () => q
          q.maybeSingle = async () => ({ data: bodyRow, error: null })
          q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null }))
          return q
        },
        insert: async () => ({ error: null }),
      }
    },
  }),
}))
const { GET, PATCH } = await import('../../app/api/admin/recall/cards/route')

const patchReq = (body: unknown) =>
  new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  requireAdmin.mockReset()
  logAdminAction.mockClear()
  tables = []; updatePatches = []; updateEqs = []; selectEqs = []; rows = []
  bodyRow = { body: BODY }
})

const asAdmin = () => requireAdmin.mockResolvedValue({ ok: true, email: 'o@example.com' })

describe('admin recall cards', () => {
  it('管理者でなければ GET も PATCH もガードの応答を返し、DBに触れない', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await GET(new Request('http://localhost/api/admin/recall/cards'))).status).toBe(403)
    // PATCH 側のガードを外しても気づけるようにする（GET だけ見ていると書き込み口が素通しになる）
    expect((await PATCH(patchReq({ claimId: 'a', clozeStatus: 'approved' }))).status).toBe(403)
    expect(tables).toEqual([])
    expect(updatePatches).toEqual([])
  })

  it('GET は recall_claims から active と cloze_status で絞り、穴を持つ主張だけを返す', async () => {
    asAdmin()
    rows = [
      { claim_id: 'a', page_id: 'p', page_title: 't', body: BODY, holes: [[0, 1]], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
      { claim_id: 'b', page_id: 'p', page_title: 't', body: BODY, holes: [], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
    ]
    const json = await (await GET(new Request('http://localhost/api/admin/recall/cards?status=pending'))).json()
    expect(json.cards.map((c: { claimId: string }) => c.claimId)).toEqual(['a'])
    expect(tables).toEqual(['recall_claims'])
    expect(selectEqs).toEqual([['active', true], ['cloze_status', 'pending']])
  })

  it('GET holes=none なら穴の無い主張を返す（最後の穴を外した主張に戻れる）', async () => {
    asAdmin()
    rows = [
      { claim_id: 'a', page_id: 'p', page_title: 't', body: BODY, holes: [[0, 1]], cloze_status: 'approved', confidence: 'ok', genres: [], genre_slot: 4, active: true },
      { claim_id: 'b', page_id: 'p', page_title: 't', body: BODY, holes: [], cloze_status: 'approved', confidence: 'ok', genres: [], genre_slot: 4, active: true },
    ]
    const json = await (await GET(new Request('http://localhost/api/admin/recall/cards?status=approved&holes=none'))).json()
    expect(json.cards.map((c: { claimId: string }) => c.claimId)).toEqual(['b'])
  })

  it('PATCH は recall_claims の当該 claim_id だけを更新し、監査ログに残す', async () => {
    asAdmin()
    const ok = await PATCH(patchReq({ claimId: 'a', clozeStatus: 'approved', holes: [[0, 2]] }))
    expect(ok.status).toBe(200)
    // 本文の読み取りと更新。どちらも recall_claims（監査ログの insert はモック側で受ける）
    expect(tables).toEqual(['recall_claims', 'recall_claims'])
    expect(updatePatches[0]).toMatchObject({ cloze_status: 'approved', holes: [[0, 2]] })
    // 絞り込みが落ちると全主張の伏せ字を一度に書き換えてしまう
    expect(updateEqs).toEqual([['claim_id', 'a']])
    // 本文の読み取りも同じ主張に絞られていること
    expect(selectEqs).toEqual([['claim_id', 'a']])
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorEmail: 'o@example.com', action: 'review_recall_cloze' }),
    )
  })

  it('PATCH は最後の穴を外せる（holes: [] は正当）', async () => {
    asAdmin()
    expect((await PATCH(patchReq({ claimId: 'a', holes: [] }))).status).toBe(200)
    expect(updatePatches[0]).toMatchObject({ holes: [] })
  })

  it('PATCH は存在しない主張なら 404（0行更新を成功と返さない）', async () => {
    asAdmin()
    bodyRow = null
    expect((await PATCH(patchReq({ claimId: 'zzz', holes: [[0, 2]] }))).status).toBe(404)
    expect(updatePatches).toEqual([])
  })

  it.each([
    ['clozeStatus が不正', { claimId: 'a', clozeStatus: 'maybe' }],
    ['claimId が無い', { clozeStatus: 'approved' }],
    ['穴が多すぎる', { claimId: 'a', holes: [[0, 1], [2, 3], [4, 5], [6, 7]] }],
    // 以下はどれも normalizeHoles が畳む・落とす形。保存できてしまうと、管理画面で見えた穴と
    // 読者に出る穴が食い違う（読者側では黙って直され、直したはずの穴が別物になる）。
    ['範囲が重なる', { claimId: 'a', holes: [[0, 4], [2, 6]] }],
    ['範囲が接する', { claimId: 'a', holes: [[0, 2], [2, 4]] }],
    ['範囲が逆順', { claimId: 'a', holes: [[5, 2]] }],
    ['本文の外を指す', { claimId: 'a', holes: [[0, 999]] }],
    ['本文の外から始まる', { claimId: 'a', holes: [[20, 30]] }],
    ['負の数', { claimId: 'a', holes: [[-3, 2]] }],
    ['整数でない', { claimId: 'a', holes: [[0, 2.5]] }],
    ['配列でない', { claimId: 'a', holes: 'x' }],
  ])('PATCH は %s なら 400 で保存しない', async (_name, body) => {
    asAdmin()
    expect((await PATCH(patchReq(body))).status).toBe(400)
    expect(updatePatches).toEqual([])
  })
})
