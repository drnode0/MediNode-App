// oauth_states の読み書き層。Supabaseクライアントはモックし、
// 「期限切れを渡さない」「一方向にしか進めない」ことを検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { insertMock, maybeSingleMock, updateEqMock, deleteMock, capturedSelect } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  updateEqMock: vi.fn(),
  deleteMock: vi.fn(),
  capturedSelect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      select: (cols: string) => {
        capturedSelect(cols)
        return {
          eq: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: maybeSingleMock }) }) }),
            maybeSingle: maybeSingleMock,
          }),
        }
      },
      update: () => ({ eq: () => ({ eq: updateEqMock }) }),
      delete: () => ({ eq: () => ({ lt: deleteMock }) }),
    }),
  }),
}))

import {
  createPendingState,
  takePendingState,
  markCompleted,
  findClaimable,
  markClaimed,
} from '../supabase/oauth-states'
import { PENDING_TTL_MS, CLAIM_WINDOW_MS } from '../oauth-state'

const NOW = Date.parse('2026-08-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null })
  maybeSingleMock.mockReset()
  updateEqMock.mockReset().mockResolvedValue({ error: null })
  deleteMock.mockReset().mockResolvedValue({ error: null })
  capturedSelect.mockReset()
})

describe('createPendingState', () => {
  it('stateを発行して行を作り、その値を返す', async () => {
    const state = await createPendingState('u1', NOW)
    expect(state).toMatch(/^[0-9a-f]{48}$/)
    expect(insertMock.mock.calls[0][0]).toMatchObject({ state, user_id: 'u1', status: 'pending' })
  })
  it('挿入に失敗したら null', async () => {
    insertMock.mockResolvedValue({ error: { message: 'boom' } })
    expect(await createPendingState('u1', NOW)).toBeNull()
  })
})

describe('takePendingState', () => {
  it('pendingかつ期限内なら行を返す', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'pending', token_enc: null, created_at: iso(NOW), completed_at: null },
      error: null,
    })
    const row = await takePendingState('s', NOW)
    expect(row?.user_id).toBe('u1')
  })
  it('期限切れなら null', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'pending', token_enc: null, created_at: iso(NOW - PENDING_TTL_MS - 1), completed_at: null },
      error: null,
    })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
  it('すでにcompletedなら null（再利用を許さない）', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW) },
      error: null,
    })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
  it('行が無い・読み取り失敗はどちらも null', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await takePendingState('s', NOW)).toBeNull()
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
})

describe('markCompleted', () => {
  it('status=completed かつ pending の行だけを更新する', async () => {
    const ok = await markCompleted('s', 'enc-token', iso(NOW))
    expect(ok).toBe(true)
    expect(updateEqMock).toHaveBeenCalled()
  })
  it('更新に失敗したら false', async () => {
    updateEqMock.mockResolvedValue({ error: { message: 'x' } })
    expect(await markCompleted('s', 'enc', iso(NOW))).toBe(false)
  })
})

describe('findClaimable', () => {
  it('猶予内のcompletedを返す', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW) },
      error: null,
    })
    const row = await findClaimable('u1', NOW)
    expect(row?.token_enc).toBe('enc')
  })
  it('猶予を過ぎていたら null', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW - CLAIM_WINDOW_MS - 1) },
      error: null,
    })
    expect(await findClaimable('u1', NOW)).toBeNull()
  })
})

describe('markClaimed', () => {
  it('token_enc を null に落として claimed にする', async () => {
    expect(await markClaimed('s')).toBe(true)
  })
})
