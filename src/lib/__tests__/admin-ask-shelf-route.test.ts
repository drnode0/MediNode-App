import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// 実在するのは @/lib/admin-guard の requireAdmin（{ ok: true; email } / { ok: false; response }）。
// ブリーフの @/lib/admin-auth は存在しないため使わない。
const state = { admin: true, patched: [] as Array<{ id: string; props: Record<string, unknown> }> }

vi.mock('@/lib/admin-guard', () => ({
  requireAdmin: async () =>
    state.admin
      ? { ok: true, email: 'owner@example.com' }
      : { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) },
}))

vi.mock('@/lib/notion-intake', () => ({
  listIntakePages: async () => [
    {
      id: 'i1',
      created_time: '2026-09-01T00:00:00.000Z',
      properties: {
        疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
        対応状態: { select: null },
        ボード公開: { checkbox: false },
        段0結果: { select: { name: '該当なし' } },
      },
    },
  ],
  updateIntakePage: async (id: string, props: Record<string, unknown>) => {
    state.patched.push({ id, props })
  },
}))

// GET は canonicalClaimIds が1件も無ければ Supabase を呼ばない実装のため、この4テストでは
// createAdminClient は未使用のはず。呼ばれても壊れないよう最小のスタブだけ用意しておく。
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  }),
}))

const route = await import('@/app/api/admin/ask-shelf/intake/route')

beforeEach(() => {
  state.admin = true
  state.patched = []
})

const patchReq = (body: unknown) =>
  new Request('http://x/api/admin/ask-shelf/intake', { method: 'PATCH', body: JSON.stringify(body) })

describe('/api/admin/ask-shelf/intake', () => {
  it('管理者でなければ403', async () => {
    state.admin = false
    const res = await route.GET()
    expect(res.status).toBe(403)
  })

  it('未対応の依頼を段0結果つきで返す', async () => {
    const res = await route.GET()
    const json = (await res.json()) as { items: Array<{ question: string; shelfResult: string }> }
    expect(json.items[0].question).toBe('ショックの見分け方は？')
    expect(json.items[0].shelfResult).toBe('該当なし')
  })

  it('正本の主張を書き戻すときは対応済みも一緒に書く', async () => {
    const res = await route.PATCH(patchReq({ id: 'i1', canonicalClaimIds: ['c9'] }))
    expect(res.status).toBe(200)
    const props = state.patched[0].props
    expect(props['正本主張ID']).toBeTruthy()
    expect(props['対応状態']).toEqual({ select: { name: '対応済み' } })
  })

  it('固定リストに無い見送りの理由は受け付けない', async () => {
    const res = await route.PATCH(patchReq({ id: 'i1', declineReason: '謎' }))
    expect(res.status).toBe(400)
    expect(state.patched).toHaveLength(0)
  })

  it('見送りの理由が「既存の記事で答えられる」なら対応済みにする', async () => {
    const res = await route.PATCH(patchReq({ id: 'i1', declineReason: '既存の記事で答えられる' }))
    expect(res.status).toBe(200)
    const props = state.patched[0].props
    expect(props['見送りの理由']).toEqual({ select: { name: '既存の記事で答えられる' } })
    expect(props['対応状態']).toEqual({ select: { name: '対応済み' } })
  })

  it('それ以外の見送りの理由は対応不要にする', async () => {
    const res = await route.PATCH(patchReq({ id: 'i1', declineReason: '根拠を確認できない' }))
    expect(res.status).toBe(200)
    const props = state.patched[0].props
    expect(props['対応状態']).toEqual({ select: { name: '対応不要' } })
  })

  it('idが無ければ400', async () => {
    const res = await route.PATCH(patchReq({ onBoard: true }))
    expect(res.status).toBe(400)
  })

  it('複数のcanonicalClaimIdsが来ても先頭の1件だけを積む', async () => {
    await route.PATCH(patchReq({ id: 'i1', canonicalClaimIds: ['c1', 'c2'] }))
    const props = state.patched[0].props
    expect(props['正本主張ID']).toEqual({ rich_text: [{ text: { content: 'c1' } }] })
  })
})
