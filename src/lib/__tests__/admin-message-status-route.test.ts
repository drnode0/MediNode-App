import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const { requireAdminMock, maintMock, dqMock, pushMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  maintMock: vi.fn(),
  dqMock: vi.fn(),
  pushMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/maintenance', () => ({ readMaintenanceFlag: maintMock }))
vi.mock('@/lib/daily-question', () => ({ readDailyQuestionStage: dqMock }))
vi.mock('@/lib/push', () => ({ readPushStage: pushMock }))

import { GET } from '../../app/api/admin/message-status/route'

beforeEach(() => {
  requireAdminMock.mockReset()
  maintMock.mockReset()
  dqMock.mockReset()
  pushMock.mockReset()
  delete process.env.PUSH_STAGE
  delete process.env.DAILY_QUESTION_STAGE
})

describe('GET /api/admin/message-status', () => {
  it('admin不許可なら guard のレスポンス', async () => {
    requireAdminMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(maintMock).not.toHaveBeenCalled()
  })

  it('許可なら3フラグの実状態を返す', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    maintMock.mockResolvedValue(false)
    dqMock.mockResolvedValue('preview')
    pushMock.mockResolvedValue('preview')
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.maintenance).toBe(false)
    expect(data.dailyQuestion).toBe('preview')
    expect(data.push).toBe('preview')
    expect(data.pushEnvOverride).toBe(false)
  })

  it('env上書きが設定されていると envOverride=true（罠を検知）', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
    maintMock.mockResolvedValue(false)
    dqMock.mockResolvedValue('on')
    pushMock.mockResolvedValue('on')
    process.env.PUSH_STAGE = 'on'
    process.env.DAILY_QUESTION_STAGE = 'off'
    const res = await GET()
    const data = await res.json()
    expect(data.pushEnvOverride).toBe(true)
    expect(data.dailyQuestionEnvOverride).toBe(true)
  })
})
