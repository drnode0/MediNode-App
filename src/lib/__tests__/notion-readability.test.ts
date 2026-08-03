// 新しいトークンで既存のDB IDが読めるかの検査。
// Notion呼び出しは差し替え可能にしてあるので、ここではネットワークに出ない。
import { describe, it, expect, vi } from 'vitest'
import { APIResponseError, APIErrorCode, RequestTimeoutError } from '@notionhq/client'
import { findUnreadableDatabases, type DbRef } from '../notion-readability'

const refs: DbRef[] = [
  { role: 'medical', id: 'db-med' },
  { role: 'reference', id: 'db-ref' },
]

// check-props/claimと同じ「読めない」コードを持つ本物のNotionクライアントエラーを作る
// （プレーンなErrorだと isNotionClientError が false を返すため、実物の型で再現する）。
const apiError = (code: APIErrorCode) =>
  new APIResponseError({ code, status: 400, message: 'boom', headers: new Headers(), rawBodyText: '' })

describe('findUnreadableDatabases', () => {
  it('全部読めれば unreadable も indeterminate も空', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [],
      indeterminate: [],
    })
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it('見えないと確認できたものだけ unreadable に入る（object_not_found）', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw apiError(APIErrorCode.ObjectNotFound)
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [{ role: 'reference', id: 'db-ref' }],
      indeterminate: [],
    })
  })

  // Finding3: レート制限やNotion側の一時的な不調は「見えない」ではなく
  // 「確認できなかった」（indeterminate）に振り分ける。
  it('rate_limitedは見えないと断定せず indeterminate に入る', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw apiError(APIErrorCode.RateLimited)
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [],
      indeterminate: [{ role: 'reference', id: 'db-ref' }],
    })
  })

  it('Notionクライアント以外の例外（通信断など、codeを持たない）は indeterminate に入る', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw new Error('fetch failed')
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [],
      indeterminate: [{ role: 'reference', id: 'db-ref' }],
    })
  })

  it('タイムアウト（RequestTimeoutError）も indeterminate に入る', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw new RequestTimeoutError()
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [],
      indeterminate: [{ role: 'reference', id: 'db-ref' }],
    })
  })

  it('空のidは検査対象にしない', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    const res = await findUnreadableDatabases({
      token: 't',
      refs: [{ role: 'medical', id: '' }, { role: 'manual', id: '  ' }],
      retrieve,
    })
    expect(res).toEqual({ unreadable: [], indeterminate: [] })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('refs が空なら Notion を呼ばない', async () => {
    const retrieve = vi.fn()
    expect(await findUnreadableDatabases({ token: 't', refs: [], retrieve })).toEqual({
      unreadable: [],
      indeterminate: [],
    })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('全部見えない場合は全部 unreadable に入る（順序は refs のまま）', async () => {
    const retrieve = vi.fn().mockRejectedValue(apiError(APIErrorCode.Unauthorized))
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: refs,
      indeterminate: [],
    })
  })

  it('unreadableとindeterminateが混在する場合はそれぞれ正しく振り分ける', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-med') throw apiError(APIErrorCode.RestrictedResource)
      if (id === 'db-ref') throw apiError(APIErrorCode.ServiceUnavailable)
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual({
      unreadable: [{ role: 'medical', id: 'db-med' }],
      indeterminate: [{ role: 'reference', id: 'db-ref' }],
    })
  })
})
