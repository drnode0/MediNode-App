// oauth_states の読み書き層。Supabaseクライアントはモックし、
// 「期限切れを渡さない」「一方向にしか進めない」ことを検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// update/select/delete それぞれのチェーンに渡された引数を記録する。
// .eq(...) は同じ引数リストへ積み上げていき、テスト側で列名と値を検証できるようにする。
const {
  insertMock,
  maybeSingleMock,
  updateMock,
  updateEqMock,
  updateSelectMock,
  updateNeqMock,
  updateLtMock,
  selectEqCalls,
  deleteEqMock,
  deleteLtMock,
  getUserByIdMock,
  createAdminClientMock,
} = vi.hoisted(() => ({
  insertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  updateMock: vi.fn(),
  updateEqMock: vi.fn(),
  updateSelectMock: vi.fn(),
  updateNeqMock: vi.fn(),
  // Finding1: purgeExpiredが追加したupdate().eq().eq().lt()チェーンの末尾を記録する。
  updateLtMock: vi.fn(),
  selectEqCalls: [] as unknown[][],
  deleteEqMock: vi.fn(),
  deleteLtMock: vi.fn(),
  // findStateOwnerEmail が使う auth.admin.getUserById。他のモックと同じ引数記録の作法に倣う。
  getUserByIdMock: vi.fn(),
  // vi.fn()で包み、createAdminClient自体が失敗するケースをテストから差し替えられるようにする。
  createAdminClientMock: vi.fn(),
}))

createAdminClientMock.mockImplementation(() => ({
  from: () => ({
    insert: insertMock,
    select: () => {
      const chain = {
        eq: (...args: unknown[]) => {
          selectEqCalls.push(args)
          return chain
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: maybeSingleMock,
      }
      return chain
    },
    update: (payload: unknown) => {
      updateMock(payload)
      const chain = {
        eq: (...args: unknown[]) => {
          updateEqMock(args)
          return chain
        },
        neq: (...args: unknown[]) => updateNeqMock(args),
        select: (cols: string) => updateSelectMock(cols),
        lt: (...args: unknown[]) => updateLtMock(args),
      }
      return chain
    },
    delete: () => ({
      eq: (...args: unknown[]) => {
        deleteEqMock(args)
        return { lt: deleteLtMock }
      },
    }),
  }),
  auth: { admin: { getUserById: getUserByIdMock } },
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: createAdminClientMock,
}))

import {
  createPendingState,
  takePendingState,
  markCompleted,
  findClaimable,
  markClaimed,
  purgeExpired,
  retireOtherCompleted,
  findStateOwnerEmail,
} from '../supabase/oauth-states'
import { PENDING_TTL_MS, CLAIM_WINDOW_MS } from '../oauth-state'

const NOW = Date.parse('2026-08-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null })
  maybeSingleMock.mockReset()
  updateMock.mockReset()
  updateEqMock.mockReset()
  updateSelectMock.mockReset().mockResolvedValue({ data: [{ state: 's' }], error: null })
  updateNeqMock.mockReset().mockResolvedValue({ error: null })
  updateLtMock.mockReset().mockResolvedValue({ error: null })
  selectEqCalls.length = 0
  deleteEqMock.mockReset()
  deleteLtMock.mockReset().mockResolvedValue({ error: null })
  getUserByIdMock.mockReset()
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
    expect(selectEqCalls).toContainEqual(['state', 's'])
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
  it('stateとstatus=pendingの両方で絞り込み、completedへの更新内容を渡す', async () => {
    const ok = await markCompleted('s', 'enc-token', iso(NOW))
    expect(ok).toBe(true)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', token_enc: 'enc-token', completed_at: iso(NOW) })
    )
    expect(updateEqMock).toHaveBeenCalledWith(['state', 's'])
    expect(updateEqMock).toHaveBeenCalledWith(['status', 'pending'])
  })
  it('更新に失敗したら false', async () => {
    updateSelectMock.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await markCompleted('s', 'enc', iso(NOW))).toBe(false)
  })
  it('述語に一致する行が無ければ（横取り済みなら）false', async () => {
    updateSelectMock.mockResolvedValue({ data: [], error: null })
    expect(await markCompleted('s', 'enc', iso(NOW))).toBe(false)
  })
})

describe('findClaimable', () => {
  it('user_idとstatus=completedで絞り込み、猶予内のcompletedを返す', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW) },
      error: null,
    })
    const row = await findClaimable('u1', NOW)
    expect(row?.token_enc).toBe('enc')
    expect(selectEqCalls).toContainEqual(['user_id', 'u1'])
    expect(selectEqCalls).toContainEqual(['status', 'completed'])
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
  it('stateとstatus=completedの両方で絞り込み、token_encをnullに落としてclaimedにする', async () => {
    expect(await markClaimed('s')).toBe(true)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'claimed', token_enc: null })
    )
    expect(updateEqMock).toHaveBeenCalledWith(['state', 's'])
    expect(updateEqMock).toHaveBeenCalledWith(['status', 'completed'])
  })
  it('更新に失敗したら false', async () => {
    updateSelectMock.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await markClaimed('s')).toBe(false)
  })
  it('述語に一致する行が無ければ（横取り済みなら）false', async () => {
    updateSelectMock.mockResolvedValue({ data: [], error: null })
    expect(await markClaimed('s')).toBe(false)
  })
})

describe('purgeExpired', () => {
  it('指定したuser_idだけを削除対象にする', async () => {
    await purgeExpired('u1', NOW)
    expect(deleteEqMock).toHaveBeenCalledWith(['user_id', 'u1'])
  })
  it('cutoffは nowMs - (PENDING_TTL_MS + CLAIM_WINDOW_MS) のISO文字列', async () => {
    await purgeExpired('u1', NOW)
    expect(deleteLtMock).toHaveBeenCalledWith('created_at', iso(NOW - (PENDING_TTL_MS + CLAIM_WINDOW_MS)))
  })

  // Finding1: 行削除のcutoffとは独立に、claimの猶予を過ぎたcompleted行のtoken_encを
  // ここで先に落とす。無期限に有効なNotionのOAuthアクセストークンを、行が消えるまで
  // （行削除のcutoffはもっと先）残さないための追加の掃除。
  describe('Finding1: claim猶予切れのcompleted行のtoken_encを行削除とは別に落とす', () => {
    it('user_id・status=completedで絞り込み、token_encをnullへ更新する', async () => {
      await purgeExpired('u1', NOW)
      expect(updateMock).toHaveBeenCalledWith({ token_enc: null })
      expect(updateEqMock).toHaveBeenCalledWith(['user_id', 'u1'])
      expect(updateEqMock).toHaveBeenCalledWith(['status', 'completed'])
    })
    it('cutoffは nowMs - CLAIM_WINDOW_MS のISO文字列（行削除cutoffより早い）', async () => {
      await purgeExpired('u1', NOW)
      expect(updateLtMock).toHaveBeenCalledWith(['completed_at', iso(NOW - CLAIM_WINDOW_MS)])
    })
    it('削除（delete）と掃除（update）の両方が実行される', async () => {
      await purgeExpired('u1', NOW)
      expect(deleteEqMock).toHaveBeenCalled()
      expect(updateMock).toHaveBeenCalled()
    })
    it('削除側が失敗しても、token_encを落とす側は実行される（例外を投げず・best-effortが独立に効く）', async () => {
      deleteLtMock.mockRejectedValue(new Error('boom'))
      await expect(purgeExpired('u1', NOW)).resolves.toBeUndefined()
      expect(updateMock).toHaveBeenCalledWith({ token_enc: null })
    })
    it('token_enc掃除側が失敗しても例外を投げない', async () => {
      updateLtMock.mockRejectedValue(new Error('boom'))
      await expect(purgeExpired('u1', NOW)).resolves.toBeUndefined()
    })
    it('createAdminClient自体が失敗しても例外を投げない', async () => {
      createAdminClientMock.mockImplementationOnce(() => {
        throw new Error('boom')
      })
      await expect(purgeExpired('u1', NOW)).resolves.toBeUndefined()
    })
  })
})

describe('retireOtherCompleted', () => {
  it('user_id・status=completedで絞り込み、引き取った行(exceptState)はneqで除外してtoken_encを落とす', async () => {
    const ok = await retireOtherCompleted('u1', 'st-claimed')
    expect(ok).toBe(true)
    expect(updateMock).toHaveBeenCalledWith({ token_enc: null })
    expect(updateEqMock).toHaveBeenCalledWith(['user_id', 'u1'])
    expect(updateEqMock).toHaveBeenCalledWith(['status', 'completed'])
    expect(updateNeqMock).toHaveBeenCalledWith(['state', 'st-claimed'])
  })
  it('更新に失敗しても例外を投げずfalseを返す', async () => {
    updateNeqMock.mockResolvedValue({ error: { message: 'boom' } })
    expect(await retireOtherCompleted('u1', 'st-claimed')).toBe(false)
  })
})

describe('findStateOwnerEmail', () => {
  it('completedの行なら持ち主のメールを返す', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'u1', status: 'completed' }, error: null })
    getUserByIdMock.mockResolvedValue({ data: { user: { email: 'owner@example.com' } }, error: null })
    const email = await findStateOwnerEmail('s')
    expect(email).toBe('owner@example.com')
    expect(selectEqCalls).toContainEqual(['state', 's'])
    expect(getUserByIdMock).toHaveBeenCalledWith('u1')
  })
  it('pendingの行なら null（getUserByIdは呼ばない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'u1', status: 'pending' }, error: null })
    expect(await findStateOwnerEmail('s')).toBeNull()
    expect(getUserByIdMock).not.toHaveBeenCalled()
  })
  it('claimedの行なら null（すでに引き取り済みのstateを覗かせない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'u1', status: 'claimed' }, error: null })
    expect(await findStateOwnerEmail('s')).toBeNull()
    expect(getUserByIdMock).not.toHaveBeenCalled()
  })
  it('行が無ければ null', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await findStateOwnerEmail('s')).toBeNull()
  })
  it('selectが失敗したら null（stateの存在を漏らさない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await findStateOwnerEmail('s')).toBeNull()
  })
  it('getUserByIdが失敗したら null', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'u1', status: 'completed' }, error: null })
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await findStateOwnerEmail('s')).toBeNull()
  })
  it('ユーザーにメールが無ければ null', async () => {
    maybeSingleMock.mockResolvedValue({ data: { user_id: 'u1', status: 'completed' }, error: null })
    getUserByIdMock.mockResolvedValue({ data: { user: { email: null } }, error: null })
    expect(await findStateOwnerEmail('s')).toBeNull()
  })
  it('空文字のstateは問い合わせせずに null', async () => {
    expect(await findStateOwnerEmail('')).toBeNull()
    expect(maybeSingleMock).not.toHaveBeenCalled()
    expect(getUserByIdMock).not.toHaveBeenCalled()
  })
})
