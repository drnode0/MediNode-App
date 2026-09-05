import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  user: { id: 'u1' } as { id: string } | null,
  page: null as Record<string, unknown> | null,
  claims: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
}

// recall_claims と recall_progress で必要なチェーンの形が違う
// （recall_claims は .eq().eq().limit()、recall_progress は .eq().eq() で終端）ため、
// テーブル名で参照する配列を切り替え、.eq() 呼び出しを実際にフィルタとして適用する。
// これにより「active=true を絞り込むコードを消すと、このテストが落ちる」形になる
// （固定フィクスチャを返すだけの旧モックだと、絞り込みを外しても検知できなかった）。
function makeQueryBuilder(rows: Record<string, unknown>[]) {
  let filtered = rows
  const builder = {
    eq(col: string, val: unknown) {
      filtered = filtered.filter((r) => r[col] === val)
      return builder
    },
    in(col: string, vals: unknown[]) {
      filtered = filtered.filter((r) => vals.includes(r[col]))
      return builder
    },
    limit(n: number) {
      return Promise.resolve({ data: filtered.slice(0, n), error: null })
    },
    then(
      resolve: (v: { data: Record<string, unknown>[]; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      return Promise.resolve({ data: filtered, error: null }).then(resolve, reject)
    },
  }
  return builder
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => makeQueryBuilder(table === 'recall_claims' ? state.claims : state.progress),
    }),
  }),
}))
vi.mock('@/lib/notion-intake', () => ({ getIntakePage: async () => state.page }))

const { GET } = await import('@/app/api/ask-shelf/answered/[id]/route')
const call = (id: string) => GET(new Request('http://x'), { params: Promise.resolve({ id }) })

const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })
beforeEach(() => {
  state.user = { id: 'u1' }
  state.claims = [{ claim_id: 'c9', page_id: 'p1', page_title: '💡 ショックの問い', section_key: 'sec3', section_heading: '3. 判定', body: '乳酸値2 mmol/L超を目安にする', source: 'ESICM 2014', confidence: 'ok', active: true }]
  state.progress = []
  state.page = {
    id: 'i1',
    properties: {
      疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
      通知先ユーザーID: rich('u1'),
      対応状態: { select: { name: '対応済み' } },
      正本主張ID: rich('c9'),
    },
  }
})

describe('GET /api/ask-shelf/answered/[id]', () => {
  it('本人には疑問と回答を返す', async () => {
    const json = await (await call('i1')).json()
    expect(json.question).toBe('ショックの見分け方は？')
    expect(json.answer.claimId).toBe('c9')
    expect(json.answer.source).toBe('ESICM 2014')
  })
  it('他人には404（1文字も返さない）', async () => {
    state.user = { id: 'u2' }
    const res = await call('i1')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
  it('未ログインは401', async () => {
    state.user = null
    expect((await call('i1')).status).toBe(401)
  })
  it('正本主張IDが無ければ answer は null（画面は疑問と状態だけ出す）', async () => {
    ;(state.page!.properties as Record<string, unknown>)['正本主張ID'] = rich('')
    const json = await (await call('i1')).json()
    expect(json.answer).toBeNull()
  })
  it('正本主張IDはあるが取り下げ済み（active:false）なら answer は null（本文を出さない）', async () => {
    state.claims = [{ ...state.claims[0], active: false }]
    const json = await (await call('i1')).json()
    expect(json.answer).toBeNull()
  })

  // 通知 cron は正本主張IDを全件 resolveAnswerTarget に渡して「最初に生きているもの」を指す。
  // ここで1件目だけを見ていると、メールのリンクを開いた先で「回答はまだ準備中です」になる。
  it('正本主張IDが2件で1件目が取り下げ済みなら、生きている2件目を出す', async () => {
    state.claims = [
      { ...state.claims[0], claim_id: 'c9', active: false },
      { claim_id: 'c10', page_id: 'p2', page_title: '💡 乳酸値の問い', section_key: 'sec2', section_heading: '2. 乳酸値', body: '乳酸値は組織低灌流の指標である', source: 'ESICM 2014', confidence: 'ok', active: true },
    ]
    ;(state.page!.properties as Record<string, unknown>)['正本主張ID'] = rich('c9,c10')
    const json = await (await call('i1')).json()
    expect(json.answer.claimId).toBe('c10')
    expect(json.answer.body).toBe('乳酸値は組織低灌流の指標である')
    expect(json.target).toEqual({ kind: 'claim', claimId: 'c10', pageId: 'p2', sectionKey: 'sec2' })
  })
})
