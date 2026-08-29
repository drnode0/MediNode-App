import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const notionRetrieve = vi.fn()
const maybeSingle = vi.fn()
const fetchSpreadNotesBlocks = vi.fn()

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}))
vi.mock('@/lib/notion-page', () => ({
  fetchPageBlocks: async () => [
    { id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 見出し' }] } },
    { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '本文。' }] } },
  ],
}))
vi.mock('@/lib/spread-notes', () => ({ fetchSpreadNotesBlocks: () => fetchSpreadNotesBlocks() }))
vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: (...a: unknown[]) => notionRetrieve(...a) } },
}))

const { GET } = await import('../../app/api/admin/spread/draft/route')

const get = (qs: string) => new Request(`http://localhost/api/admin/spread/draft${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
  notionRetrieve.mockResolvedValue({
    last_edited_time: '2026-08-28T00:00:00.000Z',
    properties: { 名前: { type: 'title', title: [{ plain_text: '酸素療法' }] } },
  })
  maybeSingle.mockResolvedValue({ data: { overlay: { shortLabels: { '1': '目標' } }, status: 'draft' }, error: null })
  fetchSpreadNotesBlocks.mockResolvedValue([{ kind: 'list_item', ordered: false, inlines: [{ text: 'ノートの一文' }] }])
})

describe('GET /api/admin/spread/draft（編集画面の下書き取得）', () => {
  it('管理者以外は requireAdmin の応答をそのまま返す（Notionにも触らない）', async () => {
    const denied = new Response('no', { status: 403 })
    requireAdmin.mockResolvedValue({ ok: false, response: denied })
    const res = await GET(get('?pageId=abc'))
    expect(res).toBe(denied)
    expect(notionRetrieve).not.toHaveBeenCalled()
  })

  it('原本・スプレッドノート・保存済みオーバレイを返す（スプレッドそのものは返さない）', async () => {
    const res = await GET(get('?pageId=abcdef0123456789abcdef0123456789'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.doc.title).toBe('酸素療法')
    expect(data.doc.blocks).toHaveLength(2)
    expect(data.notes).toHaveLength(1)
    expect(data.overlay).toEqual({ shortLabels: { '1': '目標' } })
    expect(data.status).toBe('draft')
    // 編集の土台は「今の原本＋今のオーバレイ」。保存済みのスプレッドは返さない
    expect('spread' in data).toBe(false)
    expect('spread_doc' in data).toBe(false)
  })

  it('pageId は subscription_ 接頭辞とURL断片を落として使う', async () => {
    await GET(get('?pageId=subscription_abcdef0123456789abcdef0123456789%23block'))
    expect(notionRetrieve).toHaveBeenCalledWith({ page_id: 'abcdef0123456789abcdef0123456789' })
  })

  it('pageId が無ければ400（Notionに触らない）', async () => {
    const res = await GET(get(''))
    expect(res.status).toBe(400)
    expect(notionRetrieve).not.toHaveBeenCalled()
  })

  it('スプレッドノートが無いページは notes を空配列で返す（照合先は原本だけになる）', async () => {
    fetchSpreadNotesBlocks.mockResolvedValue(null)
    const res = await GET(get('?pageId=abc'))
    expect((await res.json()).notes).toEqual([])
  })

  it('保存済みの行が無いページは空のオーバレイから始める', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const data = await (await GET(get('?pageId=abc'))).json()
    expect(data.overlay).toEqual({})
    expect(data.status).toBeNull()
  })

  it('オーバレイの読み取りに失敗したら500（空で始めて上書きさせない）', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await GET(get('?pageId=abc'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('overlay_read_failed')
  })

  it('Notionが引けないときは502', async () => {
    notionRetrieve.mockRejectedValue(new Error('nope'))
    const res = await GET(get('?pageId=abc'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('notion_fetch_failed')
  })
})
