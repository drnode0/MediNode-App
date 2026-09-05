import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// /api/cq/submit の月5件の上限（裁定6）を触るコードレビューの2件のフィックスを固定する。
//   1) 成功レスポンスに「あと1件」案内(notice)が実際に乗ること（成功時は素の
//      monthlyLimitState ではなく、この投稿を含めた後の残数で判定する。off-by-one 回帰防止）。
//   2) 月次上限チェック用の listAllIntakePages が失敗しても、投稿全体は止めない（fail open）。
//
// 他のNotion呼び出しと同じ組み立て方（vi.mock + 動的import）で、実際のroute.tsを通す。

process.env.CQ_INTAKE_NOTION_TOKEN = 'test-token'
process.env.CQ_INTAKE_DB_ID = 'test-db'

const resolveRequestPremium = vi.fn()
const rateLimitAsync = vi.fn()
const listAllIntakePages = vi.fn()
const getUser = vi.fn()
const dbRetrieve = vi.fn()
const pagesCreate = vi.fn()

vi.mock('@/lib/premium-access', () => ({
  resolveRequestPremium: () => resolveRequestPremium(),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: (...args: unknown[]) => rateLimitAsync(...args),
  clientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({}),
}))
vi.mock('@/lib/maintenance', () => ({ isAdminEmail: () => false }))
vi.mock('@/lib/cq-submission-log', () => ({ logCqSubmission: async () => {} }))
vi.mock('@/lib/notion-intake', () => ({
  listAllIntakePages: () => listAllIntakePages(),
}))
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      databases: { retrieve: (...args: unknown[]) => dbRetrieve(...args) },
      pages: { create: (...args: unknown[]) => pagesCreate(...args) },
    }
  }),
}))

const { POST } = await import('@/app/api/cq/submit/route')

const validBody = {
  question: '人工呼吸器のウィーニング、SBTの合格基準は？',
  occupation: '看護師',
  experience: '2〜3年目',
  notify: true,
}
const req = (body: unknown) =>
  new Request('http://localhost/api/cq/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest

// 直近30日以内・自分の投稿として数えられるページを n 件でっち上げる。
const recentPages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    created_time: new Date().toISOString(),
    properties: { 通知先ユーザーID: { rich_text: [{ plain_text: 'u1' }] } },
  }))

beforeEach(() => {
  resolveRequestPremium.mockReset().mockResolvedValue({ premium: true, userId: 'u1' })
  rateLimitAsync.mockReset().mockResolvedValue(true) // 1日5件・1IP20件とも通す
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'u1@example.com' } } })
  dbRetrieve.mockReset().mockResolvedValue({
    properties: { 疑問: { type: 'title' }, 通知先ユーザーID: { type: 'rich_text' } },
  })
  pagesCreate.mockReset().mockResolvedValue({ id: 'created-page' })
  listAllIntakePages.mockReset().mockResolvedValue([])
})

describe('POST /api/cq/submit の月上限「あと1件」案内', () => {
  it('この投稿の後に1件残るときだけ、成功レスポンスに notice が乗る（3件目→残り2件になるので出ない）', async () => {
    listAllIntakePages.mockResolvedValue(recentPages(3)) // この投稿で4件目、投稿後の残りは1件
    const res = await POST(req(validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.notice).toContain('あと1件')
  })

  it('この投稿が上限ちょうどになる（5件目）ときは、成功はするが notice は出さない（一つずれの回帰防止）', async () => {
    listAllIntakePages.mockResolvedValue(recentPages(4)) // この投稿で5件目＝上限ちょうど
    const res = await POST(req(validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.notice).toBeUndefined()
  })

  it('まだ近づいていなければ notice を出さない', async () => {
    listAllIntakePages.mockResolvedValue(recentPages(1))
    const res = await POST(req(validBody))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.notice).toBeUndefined()
  })

  it('既に上限に達していれば429でブロックする（従来どおり）', async () => {
    listAllIntakePages.mockResolvedValue(recentPages(5))
    const res = await POST(req(validBody))
    expect(res.status).toBe(429)
    expect(pagesCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/cq/submit の月次上限チェック取得失敗時の振る舞い（fail open）', () => {
  it('listAllIntakePages が失敗しても投稿はブロックされず成功する', async () => {
    listAllIntakePages.mockRejectedValue(new Error('Notion API down'))
    const res = await POST(req(validBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(pagesCreate).toHaveBeenCalledTimes(1)
  })

  it('取得失敗時は案内(notice)も出さない（件数が分からないため）', async () => {
    listAllIntakePages.mockRejectedValue(new Error('Notion API down'))
    const res = await POST(req(validBody))
    const json = await res.json()
    expect(json.notice).toBeUndefined()
  })
})
