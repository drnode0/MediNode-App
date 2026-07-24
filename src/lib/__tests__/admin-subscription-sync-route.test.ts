import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const { requireAdminMock, runSyncMock, revalidateMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  runSyncMock: vi.fn(),
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('../../app/api/subscription/sync/_core', () => ({ runSubscriptionSync: runSyncMock }))
vi.mock('@/lib/reader-cache', () => ({
  revalidateSubscriptionReaderDocs: revalidateMock,
  SUBSCRIPTION_READER_TAG: 'subscription-reader-doc',
}))

import { POST } from '../../app/api/admin/subscription-sync/route'

beforeEach(() => {
  requireAdminMock.mockReset()
  runSyncMock.mockReset()
  revalidateMock.mockReset()
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
    expect(revalidateMock).not.toHaveBeenCalled()
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
    // 同期成功時は本文キャッシュ（Vercel Data Cache）をパージし、次回リーダーで最新Notion本文を取得させる
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('同期がエラー結果を返したら同じstatusでerrorを返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    runSyncMock.mockResolvedValue({ ok: false, status: 500, error: '環境変数が不足しています' })
    const res = await POST()
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toBe('環境変数が不足しています')
    // 同期が失敗したら本文キャッシュはパージしない（古い本文のまま消さない）
    expect(revalidateMock).not.toHaveBeenCalled()
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
