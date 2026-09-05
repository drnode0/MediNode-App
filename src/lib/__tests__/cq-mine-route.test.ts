import { describe, it, expect, vi, beforeEach } from 'vitest'

// /api/cq/mine が「見送りの理由」を落とさずに返すこと（完了条件6）。
// toMySubmissions は理由を持っているのに、ルートの写し替えで落ちていると
// 依頼者の画面は「今回は記事化しません」だけになり、理由が誰にも届かない。

process.env.CQ_INTAKE_NOTION_TOKEN = 'test-token'
process.env.CQ_INTAKE_DB_ID = 'test-db'

const state = {
  userId: 'u1' as string | null,
  results: [] as unknown[],
}

vi.mock('@/lib/premium-access', () => ({
  resolveRequestPremium: async () => ({ premium: true, userId: state.userId, email: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return { databases: { query: async () => ({ results: state.results }) } }
  }),
}))

const { GET } = await import('@/app/api/cq/mine/route')

const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })
const page = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  created_time: '2026-09-01T00:00:00.000Z',
  properties: {
    疑問: { title: [{ plain_text: 'CHDFの開始タイミングは？' }] },
    通知先ユーザーID: rich('u1'),
    対応状態: { select: { name: '対応不要' } },
    見送りの理由: { select: { name: '根拠を確認できない' } },
    ...over,
  },
})

beforeEach(() => {
  state.userId = 'u1'
  state.results = [page()]
})

describe('GET /api/cq/mine', () => {
  it('見送りの理由を返す（画面が「今回は記事化しません」＋理由にできる）', async () => {
    const json = await (await GET()).json()
    expect(json.items).toHaveLength(1)
    expect(json.items[0].stage).toBe('closed')
    expect(json.items[0].declineReason).toBe('根拠を確認できない')
  })

  it('理由が固定リストの外なら空で返す（作者の内部の言葉を見せない）', async () => {
    state.results = [page({ 見送りの理由: { select: { name: '（作者メモ）あとで' } } })]
    const json = await (await GET()).json()
    expect(json.items[0].declineReason).toBe('')
  })

  it('未ログインなら空の一覧', async () => {
    state.userId = null
    const json = await (await GET()).json()
    expect(json.items).toEqual([])
  })
})
