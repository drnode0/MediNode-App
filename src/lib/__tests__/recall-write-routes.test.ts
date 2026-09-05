import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
let existing: Record<string, unknown> | null = null
// keep:true が recall_claims の存在確認（2026-09-05 提案006の裁定5）で使う service_role
// クライアント。既定は「実在して active」にしておき、この確認自体を狙うテストは
// 個別に上書きする（他の書き込みルートのテストはここに触れないので影響しない）。
let claimRow: Record<string, unknown> | null = { claim_id: 'a', active: true }

// どのテーブルに・何が（upsert/insert）・どんな行で書かれたか、どのテーブルをどの eq で
// 読んだかを記録する。table 引数を捨てて全テーブルへ同じスパイを渡すモックだと、
// ルートが間違ったテーブルに書いても・.eq() の絞り込みが消えても緑のままになる。
type WriteCall = { table: string; op: 'upsert' | 'insert'; row: Record<string, unknown>; opts?: Record<string, unknown> }
type ReadCall = { table: string; eq: [string, unknown][] }
let writes: WriteCall[] = []
let reads: ReadCall[] = []

function makeFrom(table: string) {
  return {
    upsert: async (row: Record<string, unknown>, opts?: Record<string, unknown>) => {
      writes.push({ table, op: 'upsert', row, opts })
      return { error: null }
    },
    insert: async (row: Record<string, unknown>) => {
      writes.push({ table, op: 'insert', row })
      return { error: null }
    },
    select: () => {
      const eq: [string, unknown][] = []
      const q = {
        eq: (column: string, value: unknown) => { eq.push([column, value]); return q },
        maybeSingle: async () => { reads.push({ table, eq }); return { data: existing, error: null } },
      }
      return q
    },
  }
}

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => makeFrom(table),
  }),
  // recall_claims は RLS ポリシー無し（service_role のみ）。keep:true の存在確認はこちらで読む。
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'recall_claims' ? claimRow : null, error: null }),
        }),
      }),
    }),
  }),
}))
const { POST: keepPOST } = await import('../../app/api/recall/keep/route')
const { POST: readPOST } = await import('../../app/api/recall/read/route')
const { POST: reviewPOST } = await import('../../app/api/recall/review/route')
const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

const writesOn = (table: string) => writes.filter((w) => w.table === table)
const readsOn = (table: string) => reads.filter((r) => r.table === table)

beforeEach(() => {
  sessionHasFeature.mockReset().mockResolvedValue(true)
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  writes = []; reads = []; existing = null
  claimRow = { claim_id: 'a', active: true }
})

describe('Recall 書き込みルート', () => {
  it('閉じていれば 404（3ルートとも）', async () => {
    sessionHasFeature.mockResolvedValue(false)
    expect((await keepPOST(req({ claimId: 'a', keep: true }))).status).toBe(404)
    expect((await readPOST(req({ pageId: 'p', sectionKey: 'sec1' }))).status).toBe(404)
    expect((await reviewPOST(req({ claimId: 'a', result: 'ok' }))).status).toBe(404)
  })

  it('残す: 新規なら間隔1日・期限翌日で recall_progress へ upsert。既存の外し済みは removed_at を null に戻し記録を保つ', async () => {
    let json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ claimId: 'a', intervalDays: 1, streak: 0, removedAt: null })
    expect(writesOn('recall_progress')).toHaveLength(1)
    expect(writesOn('recall_progress')[0].op).toBe('upsert')
    expect(writesOn('recall_progress')[0].row).toMatchObject({ user_id: 'u1', claim_id: 'a' })
    expect(writesOn('recall_progress')[0].opts).toEqual({ onConflict: 'user_id,claim_id' })

    writes = []; reads = []
    existing = { claim_id: 'a', kept_at: 'k', streak: 3, interval_days: 14, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 3, ng_count: 0, removed_at: 'x' }
    json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ streak: 3, intervalDays: 14, removedAt: null })
    // 読み戻しは本人・当該 claim だけに絞る。table 名も併せて確認する。
    expect(readsOn('recall_progress')).toHaveLength(1)
    expect(readsOn('recall_progress')[0].eq).toEqual([['user_id', 'u1'], ['claim_id', 'a']])
  })

  it('外す: removed_at を入れる。残していなければ 404', async () => {
    expect((await keepPOST(req({ claimId: 'a', keep: false }))).status).toBe(404)
    existing = { claim_id: 'a', kept_at: 'k', streak: 0, interval_days: 1, due_at: 'd', last_reviewed_at: 'l', last_result: null, ok_count: 0, ng_count: 0, removed_at: null }
    const json = await (await keepPOST(req({ claimId: 'a', keep: false }))).json()
    expect(json.progress.removedAt).toBeTruthy()
    expect(writesOn('recall_progress')).toHaveLength(1)
  })

  it('読了: recall_section_reads へ upsert（他テーブルには書かない）', async () => {
    expect((await readPOST(req({ pageId: 'p', sectionKey: 'sec1' }))).status).toBe(200)
    expect(writesOn('recall_section_reads')).toHaveLength(1)
    expect(writesOn('recall_section_reads')[0].row).toMatchObject({ user_id: 'u1', page_id: 'p', section_key: 'sec1' })
    expect(writesOn('recall_section_reads')[0].opts).toEqual({ onConflict: 'user_id,page_id,section_key' })
    expect(writesOn('recall_progress')).toHaveLength(0)
  })

  it('読了: pageId は主張側と同じ正規化（小文字・ダッシュ無し）で書く', async () => {
    // 主張の page_id は extract-claims の normalizePageId を通って入る。読了記録は
    // `pageId#sectionKey` で主張と突き合わせるので、ここを正規化しないと、呼び出し側が
    // ダッシュ付きのIDを送った日から突き合わせが静かに外れる（「読んだ」が0のまま）。
    const dashed = '1A2B3C4D-5E6F-7081-9203-A4B5C6D7E8F9'
    expect((await readPOST(req({ pageId: dashed, sectionKey: 'sec1' }))).status).toBe(200)
    expect(writesOn('recall_section_reads')[0].row).toMatchObject({
      page_id: '1a2b3c4d5e6f70819203a4b5c6d7e8f9',
      section_key: 'sec1',
    })
  })

  it('覚えた: recall_progress へ upsert（本人のIDで）・recall_review_log へ insert（本人のIDで）。残していなければ 404。result が不正なら 400', async () => {
    expect((await reviewPOST(req({ claimId: 'a', result: 'ok' }))).status).toBe(404)
    // streak:2・interval_days:3 は SRS_INTERVAL_DAYS の実際の対応（streak2→3日）に合わせた値。
    // 元の brief 案（streak:1・interval_days:3）は applyResult の実装（既存の recall-srs.test.ts で
    // 確定済み：streak N → SRS_INTERVAL_DAYS[N-1]）と矛盾していたため、間隔計算を再実装せず
    // フィクスチャ側を実装済みの挙動に合わせて直した。
    existing = { claim_id: 'a', kept_at: 'k', streak: 2, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }
    const json = await (await reviewPOST(req({ claimId: 'a', result: 'ok' }))).json()
    expect(json.progress).toMatchObject({ streak: 3, intervalDays: 7 })
    // progress の upsert（段の書き戻し）は log の insert とは別物として、テーブル名・user_id 込みで確認する。
    expect(writesOn('recall_progress')).toHaveLength(1)
    expect(writesOn('recall_progress')[0].op).toBe('upsert')
    expect(writesOn('recall_progress')[0].row).toMatchObject({ user_id: 'u1', claim_id: 'a', streak: 3, interval_days: 7 })
    expect(writesOn('recall_review_log')).toHaveLength(1)
    expect(writesOn('recall_review_log')[0].row).toMatchObject({ user_id: 'u1', claim_id: 'a', result: 'ok', interval_before: 3, interval_after: 7 })
    expect((await reviewPOST(req({ claimId: 'a', result: 'maybe' }))).status).toBe(400)
  })

  it('外した主張（removed_at 有り）を確かめようとすると、記録が無い場合と同じ404（復活させない）', async () => {
    existing = { claim_id: 'a', kept_at: 'k', streak: 3, interval_days: 14, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 3, ng_count: 0, removed_at: '2026-01-01T00:00:00.000Z' }
    const res = await reviewPOST(req({ claimId: 'a', result: 'ok' }))
    expect(res.status).toBe(404)
    // 外した主張を読んだだけで書き戻し（＝復活）が起きてはいけない。
    expect(writesOn('recall_progress')).toHaveLength(0)
    expect(writesOn('recall_review_log')).toHaveLength(0)
  })

  describe('id のバリデーション（空文字・長すぎる値を弾く）', () => {
    const tooLong = 'x'.repeat(200)

    it('keep: claimId が空文字・長すぎる場合は 400 で recall_progress に触れない', async () => {
      for (const claimId of ['', '   ', tooLong]) {
        writes = []; reads = []
        const res = await keepPOST(req({ claimId, keep: true }))
        expect(res.status, `claimId=${JSON.stringify(claimId).slice(0, 20)}`).toBe(400)
        expect((await res.json()).error).toBe('claimId と keep が必要です')
        expect(writes).toHaveLength(0)
        expect(reads).toHaveLength(0)
      }
    })

    it('review: claimId が空文字・長すぎる場合は 400 で recall_progress に触れない', async () => {
      for (const claimId of ['', tooLong]) {
        writes = []; reads = []
        const res = await reviewPOST(req({ claimId, result: 'ok' }))
        expect(res.status).toBe(400)
        expect((await res.json()).error).toBe('claimId と result（ok/ng）が必要です')
        expect(writes).toHaveLength(0)
        expect(reads).toHaveLength(0)
      }
    })

    it('read: pageId・sectionKey が空文字・長すぎる場合は 400 で recall_section_reads に触れない', async () => {
      const cases: Array<[string, string]> = [['', 'sec1'], ['p', ''], [tooLong, 'sec1'], ['p', tooLong]]
      for (const [pageId, sectionKey] of cases) {
        writes = []
        const res = await readPOST(req({ pageId, sectionKey }))
        expect(res.status, `pageId=${pageId.slice(0, 10)} sectionKey=${sectionKey.slice(0, 10)}`).toBe(400)
        expect((await res.json()).error).toBe('pageId と sectionKey が必要です')
        expect(writes).toHaveLength(0)
      }
    })

    it('read: 前後の空白は trim してから書き込む', async () => {
      const res = await readPOST(req({ pageId: '  p  ', sectionKey: '  sec1  ' }))
      expect(res.status).toBe(200)
      expect(writesOn('recall_section_reads')[0].row).toMatchObject({ page_id: 'p', section_key: 'sec1' })
    })
  })
})
