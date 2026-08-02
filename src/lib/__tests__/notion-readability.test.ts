// 新しいトークンで既存のDB IDが読めるかの検査。
// Notion呼び出しは差し替え可能にしてあるので、ここではネットワークに出ない。
import { describe, it, expect, vi } from 'vitest'
import { findUnreadableDatabases, type DbRef } from '../notion-readability'

const refs: DbRef[] = [
  { role: 'medical', id: 'db-med' },
  { role: 'reference', id: 'db-ref' },
]

describe('findUnreadableDatabases', () => {
  it('全部読めれば空配列', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual([])
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it('読めないものだけを返す', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw new Error('Could not find database')
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual([
      { role: 'reference', id: 'db-ref' },
    ])
  })

  it('空のidは検査対象にしない', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    const res = await findUnreadableDatabases({
      token: 't',
      refs: [{ role: 'medical', id: '' }, { role: 'manual', id: '  ' }],
      retrieve,
    })
    expect(res).toEqual([])
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('refs が空なら Notion を呼ばない', async () => {
    const retrieve = vi.fn()
    expect(await findUnreadableDatabases({ token: 't', refs: [], retrieve })).toEqual([])
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('全部読めない場合は全部返る（順序は refs のまま）', async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error('unauthorized'))
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual(refs)
  })
})
