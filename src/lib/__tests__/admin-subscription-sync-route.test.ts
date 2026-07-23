import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const { requireAdminMock, runSyncMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  runSyncMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('../../app/api/subscription/sync/_core', () => ({ runSubscriptionSync: runSyncMock }))

import { POST } from '../../app/api/admin/subscription-sync/route'

beforeEach(() => {
  requireAdminMock.mockReset()
  runSyncMock.mockReset()
})

describe('POST /api/admin/subscription-sync', () => {
  it('admin不許可なら guard のレスポンスを返し、同期を呼ばない', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    })
    const res = await POST()
    expect(res.status).toBe(403)
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  it('admin許可なら runSubscriptionSync に委譲し結果を200で返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    runSyncMock.mockResolvedValue({
      success: true,
      synced: { medical: 3, reference: 2, total: 5 },
      index: 'Medical Knowledge_DB（サブスク用）',
    })
    const res = await POST()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(runSyncMock).toHaveBeenCalledTimes(1)
    expect(data.synced.total).toBe(5)
  })

  it('同期がエラー結果を返したら同じstatusでerrorを返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    runSyncMock.mockResolvedValue({ ok: false, status: 500, error: '環境変数が不足しています' })
    const res = await POST()
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toBe('環境変数が不足しています')
  })

  it('想定外の例外は500でJSONを返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    runSyncMock.mockRejectedValue(new Error('boom'))
    const res = await POST()
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toBe('boom')
  })
})
