// check-props API のテスト。接続確認に加えて、列名マッピングUIのために
// DBの全プロパティ（名前と型）を schema として返すことを担保する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { guardMock, retrieveMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  retrieveMock: vi.fn(),
}))

vi.mock('@/lib/api-guard', () => ({ requireSessionOrSetupRateLimit: guardMock }))
vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = { retrieve: retrieveMock }
  },
  // ルートは isNotionClientError も import している（Notionエラーの code を
  // 取り出すため）。このモックに無いとその import 自体が失敗して全テストが落ちる。
  isNotionClientError: () => false,
}))

import { POST } from '../../app/api/notion/check-props/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) =>
  ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue(null)
  retrieveMock.mockReset()
})

describe('POST /api/notion/check-props', () => {
  it('missing判定に加えて schema（列名と型の一覧）を返す', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        名前: { type: 'title' },
        サマリー: { type: 'rich_text' },
        カテゴリ: { type: 'multi_select' },
      },
    })
    const res = await POST(makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db1' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.medical.missing).toContain('要約')
    expect(data.medical.schema).toEqual([
      { name: '名前', type: 'title' },
      { name: 'サマリー', type: 'rich_text' },
      { name: 'カテゴリ', type: 'multi_select' },
    ])
  })

  it('Reference DB 指定時は reference.schema も返す', async () => {
    retrieveMock
      .mockResolvedValueOnce({ properties: { 名前: { type: 'title' } } })
      .mockResolvedValueOnce({ properties: { 論文名: { type: 'title' }, 要約: { type: 'rich_text' } } })
    const res = await POST(
      makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db1', notionReferenceDbId: 'db2' }),
    )
    const data = await res.json()
    expect(data.reference.schema).toEqual([
      { name: '論文名', type: 'title' },
      { name: '要約', type: 'rich_text' },
    ])
  })
})
