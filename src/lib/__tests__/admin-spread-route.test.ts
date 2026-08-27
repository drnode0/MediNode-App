import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const upsert = vi.fn()
const notionRetrieve = vi.fn()
const logAdminAction = vi.fn()
const revalidateSubscriptionReaderDocs = vi.fn()
// PUT が overlay 省略時に読みに行く既存行、PATCH が読みに行く既存行、どちらも
// 同じ select().eq().maybeSingle() 経路を通るので1本の vi.fn で共有する。
const maybeSingle = vi.fn()
let selectRows: unknown[] = []
let existingOverlayRow: { overlay: unknown; status?: string; source_last_edited?: string | null } | null = null
let overlayReadError: unknown = null

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction }))
vi.mock('@/lib/reader-cache', () => ({ revalidateSubscriptionReaderDocs }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert,
      select: () => ({
        order: () => ({ data: selectRows, error: null }),
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}))
vi.mock('@/lib/notion-page', () => ({
  fetchPageBlocks: async () => [
    { id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 見出し' }] } },
    { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '本文。' }] } },
  ],
}))
vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: (...a: unknown[]) => notionRetrieve(...a) } },
}))

const { PUT, PATCH, GET } = await import('../../app/api/admin/spread/route')

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/spread', { method: 'PUT', body: JSON.stringify(body) })

const patchReq = (body: unknown) =>
  new Request('http://localhost/api/admin/spread', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
  requireAdmin.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  notionRetrieve.mockResolvedValue({ last_edited_time: '2026-08-20T00:00:00.000Z', properties: {} })
  upsert.mockResolvedValue({ error: null })
  selectRows = []
  existingOverlayRow = null
  overlayReadError = null
  // 既定は「保存済み行を variable ベースで返す」。PATCH のテストなど、行の中身を
  // 直接指定したいときだけ maybeSingle.mockResolvedValue で個別に上書きする。
  maybeSingle.mockImplementation(async () => ({ data: existingOverlayRow, error: overlayReadError }))
})

describe('PUT /api/admin/spread', () => {
  it('管理者でなければ弾く', async () => {
    const { NextResponse } = await import('next/server')
    requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('原本から誌面を組んで保存する', async () => {
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.page_id).toBe('p1')
    expect(saved.status).toBe('draft')
    expect(saved.spread_doc.sections).toHaveLength(1)
    expect(saved.source_last_edited).toBe('2026-08-20T00:00:00.000Z')

    // 監査ログが呼ばれ、action が 'put_spread' であること
    expect(logAdminAction).toHaveBeenCalled()
    const auditCall = logAdminAction.mock.calls[0]
    expect(auditCall[1].action).toBe('put_spread')
    // pageId が detail に入り、targetUserId には入らないこと
    expect(auditCall[1].detail.pageId).toBe('p1')
    expect(auditCall[1].targetUserId).toBeUndefined()

    // キャッシュ失効が呼ばれたこと
    expect(revalidateSubscriptionReaderDocs).toHaveBeenCalled()
  })

  it('publish: true なら公開状態で保存する', async () => {
    await PUT(req({ pageId: 'p1', publish: true }))
    expect(upsert.mock.calls[0][0].status).toBe('published')
    // action が 'publish_spread' になることを確認
    const auditCall = logAdminAction.mock.calls[0]
    expect(auditCall[1].action).toBe('publish_spread')
  })

  it('overlay を指定しない PUT は、既存行の overlay を読んで保存し直す（全消しにしない）', async () => {
    // 「再生成」ボタンは { pageId, publish } しか送らない（overlay を含めない）。
    // ここで body.overlay ?? {} のままだと、保存済みの短ラベルが空で上書きされる。
    existingOverlayRow = { overlay: { shortLabels: { '1': '目視済みラベル' } } }
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    // overlay 列そのものが既存の中身のまま保存し直されること
    expect(saved.overlay).toEqual({ shortLabels: { '1': '目視済みラベル' } })
    // spread_doc にも既存 overlay が反映されていること（空のオーバレイで潰されていない）
    expect(saved.spread_doc.sections[0].shortLabel).toBe('目視済みラベル')
  })

  it('overlay を指定しない PUT（再生成）は、既存の理解チェックの目視も保つ', async () => {
    // shortLabels だけでなく quizzes.reviewed も再生成で消えないことを固定する。
    // ここが崩れると、再生成のたびに目視をやり直すことになる。
    existingOverlayRow = {
      overlay: {
        quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: true },
        ],
      },
    }
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.overlay.quizzes[0].reviewed).toBe(true)
    // spread_doc（読者に届く実体）側でも保たれていること
    expect(saved.spread_doc.quizzes[0].reviewed).toBe(true)
  })

  it('overlay を明示的に渡した PUT は、既存行を読みに行かずそれを使う', async () => {
    existingOverlayRow = { overlay: { shortLabels: { '1': '古いラベル' } } }
    const res = await PUT(req({ pageId: 'p1', overlay: { shortLabels: { '1': '新しいラベル' } } }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.spread_doc.sections[0].shortLabel).toBe('新しいラベル')
  })

  it('保存済みオーバレイの読み取りが失敗したときは、空オーバレイで保存せずエラーを返す', async () => {
    // overlay 省略時に既存行を読もうとするが読み取りエラーが発生
    overlayReadError = new Error('Connection refused')
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('overlay_read_failed')
    // 投入されないこと
    expect(upsert).not.toHaveBeenCalled()
    // 監査ログとキャッシュ失効は呼ばれない
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(revalidateSubscriptionReaderDocs).not.toHaveBeenCalled()
  })

  it('原本に無い文を含むオーバレイは400で拒否する', async () => {
    const res = await PUT(req({
      pageId: 'p1',
      overlay: { parts: { '1': { kind: 'bignumber', value: '99%', caption: [{ text: '原本に無い文。' }] } } },
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('verbatim_mismatch')
    expect(body.missing).toContain('原本に無い文。')
    expect(upsert).not.toHaveBeenCalled()
    // 拒否されたときは監査ログとキャッシュ失効は呼ばれない
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(revalidateSubscriptionReaderDocs).not.toHaveBeenCalled()
  })
})

describe('目視の関門', () => {
  it('投入された overlay の設問は reviewed を必ず false に落として保存する', async () => {
    await PUT(req({
      pageId: 'p1',
      overlay: { quizzes: [{ id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: true }] },
    }))
    const saved = upsert.mock.calls[0][0]
    expect(saved.spread_doc.quizzes[0].reviewed).toBe(false)
    expect(saved.overlay.quizzes[0].reviewed).toBe(false)
  })

  it('PATCH は指定した設問だけ reviewed を立て、status は変えない。spread_doc にも反映する', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
          { id: 'q2', sectionAnchor: '1', question: '？？', choices: ['a', 'b'], answerIndex: 1, evidence: '本文。', reviewed: false },
        ] },
        status: 'published',
        // notionRetrieve（beforeEach）が返す last_edited_time と一致させる。
        // 一致しないと修正1の409拒否に落ちてこのテストの意図と別物になる。
        source_last_edited: '2026-08-20T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.status).toBe('published')
    expect(saved.overlay.quizzes.find((q: { id: string }) => q.id === 'q1').reviewed).toBe(true)
    expect(saved.overlay.quizzes.find((q: { id: string }) => q.id === 'q2').reviewed).toBe(false)
    // overlay のフラグだけでなく、読者に届く spread_doc 側にも反映されること。
    // ここが最も強く釘を刺された要件（applyOverlay の呼び出しを外してもテストが
    // 通ってしまう、を防ぐ）。
    expect(saved.spread_doc.quizzes.find((q: { id: string }) => q.id === 'q1').reviewed).toBe(true)
    expect(saved.spread_doc.quizzes.find((q: { id: string }) => q.id === 'q2').reviewed).toBe(false)

    expect(logAdminAction).toHaveBeenCalled()
    expect(logAdminAction.mock.calls[0][1].action).toBe('review_quiz')
    expect(revalidateSubscriptionReaderDocs).toHaveBeenCalled()
  })

  it('PATCH は管理者でなければ弾く', async () => {
    const { NextResponse } = await import('next/server')
    requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(403)
  })

  it('PATCH は行が無ければ404で拒否する', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('PATCH は指定した設問が行に無ければ404で拒否する', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
        ] },
        status: 'draft',
        source_last_edited: '2026-08-20T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q-not-exist', reviewed: true }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('quiz_not_found')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('PATCH は根拠の逐語が原本に無ければ400で拒否し、監査ログもキャッシュ失効も呼ばない', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '原本に無い文。', reviewed: false },
        ] },
        status: 'draft',
        source_last_edited: '2026-08-20T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('verbatim_mismatch')
    expect(body.missing).toContain('原本に無い文。')
    expect(upsert).not.toHaveBeenCalled()
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(revalidateSubscriptionReaderDocs).not.toHaveBeenCalled()
  })

  it('PATCH も PUT と同じ正規化で pageId を受け取る（subscription_接頭辞・#断片を落とす）', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
        ] },
        status: 'draft',
        source_last_edited: '2026-08-20T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'subscription_p1#見出し', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0].page_id).toBe('p1')
  })
})

describe('承認は公開の裏口にしない（原本と保存済み source_last_edited の突合）', () => {
  it('原本の最終更新が保存済み source_last_edited と食い違えば409で拒否し、保存しない', async () => {
    // notionRetrieve は beforeEach で last_edited_time: '2026-08-20T00:00:00.000Z' を返す。
    // 保存済みの source_last_edited をそれと違う値にして「原本を直した後、再生成せずに
    // 承認しようとした」状態を再現する。
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
        ] },
        status: 'published',
        source_last_edited: '2026-08-19T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('source_changed')
    // 再生成が要ることが分かる情報を返すこと（/admin側でメッセージにできる形）
    expect(typeof body.message).toBe('string')
    expect(upsert).not.toHaveBeenCalled()
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(revalidateSubscriptionReaderDocs).not.toHaveBeenCalled()
  })

  it('保存済み source_last_edited が null（比較不能）でも409で拒否する（安全側に倒す）', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
        ] },
        status: 'published',
        source_last_edited: null,
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('source_changed')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('原本の最終更新と保存済み source_last_edited が一致していれば承認できる', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        overlay: { quizzes: [
          { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
        ] },
        status: 'published',
        source_last_edited: '2026-08-20T00:00:00.000Z',
      },
      error: null,
    })
    const res = await PATCH(patchReq({ pageId: 'p1', quizId: 'q1', reviewed: true }))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalled()
  })
})

const getReq = (qs = '') => new Request(`http://localhost/api/admin/spread${qs}`)

describe('GET /api/admin/spread', () => {
  it('管理者でなければ弾く', async () => {
    const { NextResponse } = await import('next/server')
    requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await GET(getReq())
    expect(res.status).toBe(403)
  })

  it('?check=1 が無ければNotionに問い合わせず一覧をそのまま返す（quizzesはoverlayから取り出す）', async () => {
    const quizzes = [
      { id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0, evidence: '本文。', reviewed: false },
    ]
    selectRows = [
      { page_id: 'p1', status: 'draft', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: null, updated_at: '2026-08-01T00:00:00.000Z', overlay: { quizzes } },
    ]
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.spreads).toEqual([
      { page_id: 'p1', status: 'draft', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: null, updated_at: '2026-08-01T00:00:00.000Z', quizzes },
    ])
    // overlay 列そのものは応答に残らないこと（spread_doc 同様に重いものは返さない）
    expect(body.spreads[0].overlay).toBeUndefined()
    expect(notionRetrieve).not.toHaveBeenCalled()
  })

  it('overlay に quizzes が無い行は quizzes: [] を返す', async () => {
    selectRows = [
      { page_id: 'p1', status: 'draft', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: null, updated_at: '2026-08-01T00:00:00.000Z' },
    ]
    const res = await GET(getReq())
    const body = await res.json()
    expect(body.spreads[0].quizzes).toEqual([])
  })

  it('?check=1 かつ原本の最終更新が新しければ stale: true を返す', async () => {
    selectRows = [
      { page_id: 'p1', status: 'published', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' },
    ]
    // 原本の最終更新（beforeEachで2026-08-20）が誌面の source_last_edited（2026-08-01）より新しい
    const res = await GET(getReq('?check=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(notionRetrieve).toHaveBeenCalledWith({ page_id: 'p1' })
    expect(body.spreads[0].stale).toBe(true)
  })

  it('?check=1 でも原本が誌面より古ければ stale: false', async () => {
    selectRows = [
      { page_id: 'p1', status: 'published', source_last_edited: '2026-08-25T00:00:00.000Z', verified_at: '2026-08-25T00:00:00.000Z', updated_at: '2026-08-25T00:00:00.000Z' },
    ]
    // beforeEachのnotionRetrieveは last_edited_time: 2026-08-20 なので誌面の方が新しい
    const res = await GET(getReq('?check=1'))
    const body = await res.json()
    expect(body.spreads[0].stale).toBe(false)
  })

  it('?check=1 でも原本が引けなければ stale: false（誤検知させない）', async () => {
    selectRows = [
      { page_id: 'p1', status: 'draft', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: null, updated_at: '2026-08-01T00:00:00.000Z' },
    ]
    notionRetrieve.mockRejectedValue(new Error('not found'))
    const res = await GET(getReq('?check=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.spreads[0].stale).toBe(false)
  })

  it('?check=1 でもトークン未設定ならNotionに問い合わせない', async () => {
    delete process.env.SUBSCRIPTION_NOTION_TOKEN
    selectRows = [
      { page_id: 'p1', status: 'draft', source_last_edited: '2026-08-01T00:00:00.000Z', verified_at: null, updated_at: '2026-08-01T00:00:00.000Z' },
    ]
    const res = await GET(getReq('?check=1'))
    expect(res.status).toBe(200)
    expect(notionRetrieve).not.toHaveBeenCalled()
  })
})
