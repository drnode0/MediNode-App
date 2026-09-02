import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
const upsert = vi.fn(async () => ({ error: null }))
const insert = vi.fn(async () => ({ error: null }))
let existing: Record<string, unknown> | null = null
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      upsert, insert,
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
    }),
  }),
}))
const { POST: keepPOST } = await import('../../app/api/recall/keep/route')
const { POST: readPOST } = await import('../../app/api/recall/read/route')
const { POST: reviewPOST } = await import('../../app/api/recall/review/route')
const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  sessionHasFeature.mockReset().mockResolvedValue(true)
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  upsert.mockClear(); insert.mockClear(); existing = null
})

describe('Recall 書き込みルート', () => {
  it('閉じていれば 404', async () => {
    sessionHasFeature.mockResolvedValue(false)
    expect((await keepPOST(req({ claimId: 'a', keep: true }))).status).toBe(404)
  })
  it('残す: 新規なら間隔1日・期限翌日で upsert。既存の外し済みは removed_at を null に戻し記録を保つ', async () => {
    let json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ claimId: 'a', intervalDays: 1, streak: 0, removedAt: null })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', claim_id: 'a' }), { onConflict: 'user_id,claim_id' })
    existing = { claim_id: 'a', kept_at: 'k', streak: 3, interval_days: 14, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 3, ng_count: 0, removed_at: 'x' }
    json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ streak: 3, intervalDays: 14, removedAt: null })
  })
  it('外す: removed_at を入れる。残していなければ 404', async () => {
    expect((await keepPOST(req({ claimId: 'a', keep: false }))).status).toBe(404)
    existing = { claim_id: 'a', kept_at: 'k', streak: 0, interval_days: 1, due_at: 'd', last_reviewed_at: 'l', last_result: null, ok_count: 0, ng_count: 0, removed_at: null }
    const json = await (await keepPOST(req({ claimId: 'a', keep: false }))).json()
    expect(json.progress.removedAt).toBeTruthy()
  })
  it('読了: 節を upsert', async () => {
    expect((await readPOST(req({ pageId: 'p', sectionKey: 'sec1' }))).status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', page_id: 'p', section_key: 'sec1' }), { onConflict: 'user_id,page_id,section_key' })
  })
  it('覚えた: 段を進めて upsert しログを insert。残していなければ 404。result が不正なら 400', async () => {
    expect((await reviewPOST(req({ claimId: 'a', result: 'ok' }))).status).toBe(404)
    // streak:2・interval_days:3 は SRS_INTERVAL_DAYS の実際の対応（streak2→3日）に合わせた値。
    // 元の brief 案（streak:1・interval_days:3）は applyResult の実装（既存の recall-srs.test.ts で
    // 確定済み：streak N → SRS_INTERVAL_DAYS[N-1]）と矛盾していたため、間隔計算を再実装せず
    // フィクスチャ側を実装済みの挙動に合わせて直した。
    existing = { claim_id: 'a', kept_at: 'k', streak: 2, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }
    const json = await (await reviewPOST(req({ claimId: 'a', result: 'ok' }))).json()
    expect(json.progress).toMatchObject({ streak: 3, intervalDays: 7 })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ claim_id: 'a', result: 'ok', interval_before: 3, interval_after: 7 }))
    expect((await reviewPOST(req({ claimId: 'a', result: 'maybe' }))).status).toBe(400)
  })
})
