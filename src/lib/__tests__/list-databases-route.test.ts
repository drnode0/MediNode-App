// list-databases ルートのテスト。search APIの結果をid/titleに整形して返す。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { guardMock, searchMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  searchMock: vi.fn(),
}))
vi.mock('@/lib/api-guard', () => ({ requireSessionOrSetupRateLimit: guardMock }))
vi.mock('@notionhq/client', () => ({
  Client: class { search = searchMock },
}))

import { POST } from '../../app/api/notion/list-databases/route'
import type { NextRequest } from 'next/server'
const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue(null)
  searchMock.mockReset()
})

describe('POST /api/notion/list-databases', () => {
  it('database だけをid/titleで返す（titleはplain_text連結・空はUntitled扱い）', async () => {
    searchMock.mockResolvedValue({
      results: [
        { object: 'database', id: 'db1', title: [{ plain_text: 'Medical ' }, { plain_text: 'DB' }] },
        { object: 'database', id: 'db2', title: [] },
        { object: 'page', id: 'p1' },
      ],
    })
    const res = await POST(makeReq({ notionToken: 'ntn_x' }))
    const data = await res.json()
    expect(data.databases).toEqual([
      { id: 'db1', title: 'Medical DB' },
      { id: 'db2', title: '（無題のデータベース）' },
    ])
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { property: 'object', value: 'database' }, page_size: 100 }),
    )
  })

  it('notionToken が無ければ400', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })
})
