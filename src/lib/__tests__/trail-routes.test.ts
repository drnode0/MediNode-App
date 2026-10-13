import { describe, it, expect, vi, beforeEach } from 'vitest'

// 本人のセッション（RLS）だけで読み書きするルート群を、メモリ上の小さな表で確かめる。
// 本物の Supabase と同じく、trail_lookups の (user_id, norm) は一意（違反は 23505）。
type Row = Record<string, unknown>
const state = {
  feature: true,
  user: { id: 'u1' } as { id: string } | null,
  tables: { trail_lookups: [] as Row[], saved_items: [] as Row[] } as Record<string, Row[]>,
  seq: 0,
}

function uuid(): string {
  state.seq += 1
  return `00000000-0000-4000-8000-${String(state.seq).padStart(12, '0')}`
}

function uniqueViolation(table: string, rows: Row[], candidate: Row, selfId?: unknown) {
  if (table !== 'trail_lookups') return false
  return rows.some((r) => r.id !== selfId && r.user_id === candidate.user_id && r.norm === candidate.norm)
}

function builder(table: string) {
  const filters: Array<[string, unknown]> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Row = {}
  let orderCol: string | null = null
  let asc = true
  let lim = Infinity
  let single: 'single' | 'maybe' | null = null
  const rows = () => state.tables[table]
  const match = (r: Row) => filters.every(([c, v]) => r[c] === v)

  const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
    if (op === 'insert') {
      const row: Row = { id: uuid(), created_at: new Date().toISOString(), ...payload }
      if (table === 'trail_lookups') row.times ??= 1
      if (table === 'trail_lookups') row.outside ??= []
      if (uniqueViolation(table, rows(), row)) return { data: null, error: { message: 'dup', code: '23505' } }
      rows().push(row)
      return { data: single ? row : [row], error: null }
    }
    if (op === 'update') {
      const hit = rows().filter(match)
      for (const r of hit) {
        if (uniqueViolation(table, rows(), { ...r, ...payload }, r.id)) return { data: null, error: { message: 'dup', code: '23505' } }
      }
      hit.forEach((r) => Object.assign(r, payload))
      return { data: null, error: null }
    }
    if (op === 'delete') {
      state.tables[table] = rows().filter((r) => !match(r))
      return { data: null, error: null }
    }
    let out = rows().filter(match)
    if (orderCol) {
      const c = orderCol
      out = [...out].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (asc ? 1 : -1))
    }
    out = out.slice(0, lim)
    if (single === 'single') return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } }
    if (single === 'maybe') return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }

  const q: Record<string, unknown> = {
    select: () => q,
    insert: (v: Row) => { op = 'insert'; payload = v; return q },
    update: (v: Row) => { op = 'update'; payload = v; return q },
    delete: () => { op = 'delete'; return q },
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q },
    order: (c: string, o?: { ascending?: boolean }) => { orderCol = c; asc = o?.ascending !== false; return q },
    limit: (n: number) => { lim = n; return q },
    single: () => { single = 'single'; return Promise.resolve(run()) },
    maybeSingle: () => { single = 'maybe'; return Promise.resolve(run()) },
    then: (res: (v: ReturnType<typeof run>) => void, rej?: (e: unknown) => void) => {
      try { res(run()) } catch (e) { rej?.(e) }
    },
  }
  return q
}

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => builder(t),
  }),
}))

const lookupRoute = await import('@/app/api/trail/lookup/route')
const outsideRoute = await import('@/app/api/trail/outside/route')
const savesRoute = await import('@/app/api/trail/saves/route')
const lookupsRoute = await import('@/app/api/trail/lookups/route')

const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  state.feature = true
  state.user = { id: 'u1' }
  state.tables = { trail_lookups: [], saved_items: [] }
  state.seq = 0
})

describe('POST /api/trail/lookup', () => {
  it('機能が閉じていれば本文の無い404', async () => {
    state.feature = false
    const res = await post(lookupRoute.POST, { query: '敗血症 初期輸液' })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
  it('ほかのメソッドも同じ404で閉じる', async () => {
    expect((await lookupRoute.GET()).status).toBe(404)
  })
  it('未ログインは401', async () => {
    state.user = null
    expect((await post(lookupRoute.POST, { query: '敗血症' })).status).toBe(401)
  })
  it('照合できない問いは400', async () => {
    expect((await post(lookupRoute.POST, { query: 'a' })).status).toBe(400)
  })
  it('はじめての言葉は記録を作り、前の自分は無い', async () => {
    const res = await post(lookupRoute.POST, { query: '敗血症 初期輸液' })
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(j.previous).toEqual({ saved: [], lookups: [] })
    expect(state.tables.trail_lookups).toHaveLength(1)
    expect(state.tables.trail_lookups[0]).toMatchObject({ user_id: 'u1', query: '敗血症 初期輸液', norm: '敗血症初期輸液' })
    expect(j.lookupId).toBe(state.tables.trail_lookups[0].id)
  })
  it('前の機会に調べた言葉は「前の自分」として返し、同じ行を進める', async () => {
    state.tables.trail_lookups.push({
      id: 'old', user_id: 'u1', query: '敗血症 初期輸液', norm: '敗血症初期輸液',
      first_searched_at: ago(40 * DAY), last_searched_at: ago(40 * DAY), times: 1, outside: ['pubmed'],
    })
    const j = await (await post(lookupRoute.POST, { query: '敗血症　初期輸液' })).json()
    expect(j.previous.lookups).toEqual([{ id: 'old', query: '敗血症 初期輸液', lastSearchedAt: expect.any(String), outside: ['pubmed'] }])
    expect(j.lookupId).toBe('old')
    expect(state.tables.trail_lookups).toHaveLength(1)
    expect(state.tables.trail_lookups[0].times).toBe(2)
  })
  it('ほかの人の記録には一致しない', async () => {
    state.tables.trail_lookups.push({
      id: 'theirs', user_id: 'u2', query: '敗血症 初期輸液', norm: '敗血症初期輸液',
      first_searched_at: ago(40 * DAY), last_searched_at: ago(40 * DAY), times: 1, outside: [],
    })
    const j = await (await post(lookupRoute.POST, { query: '敗血症 初期輸液' })).json()
    expect(j.previous.lookups).toEqual([])
    expect(state.tables.trail_lookups.filter((r) => r.user_id === 'u1')).toHaveLength(1)
  })
  it('record: false なら照合だけして書かない', async () => {
    const j = await (await post(lookupRoute.POST, { query: '敗血症 初期輸液', record: false })).json()
    expect(j.lookupId).toBeNull()
    expect(state.tables.trail_lookups).toHaveLength(0)
  })
  it('打ちかけの断片は、続きの言葉に書き換える', async () => {
    await post(lookupRoute.POST, { query: '敗血症 初期' })
    await post(lookupRoute.POST, { query: '敗血症 初期輸液' })
    expect(state.tables.trail_lookups.map((r) => r.query)).toEqual(['敗血症 初期輸液'])
  })
  it('残したものが今の問いを覆えば、それを返す', async () => {
    state.tables.saved_items.push({
      id: 's1', user_id: 'u1', origin: 'lookup', lookup_id: null, query: 'セフトリアキソン 偽胆石',
      title: '', note: '小児で起きやすい', body: '', url: 'https://www.pmda.go.jp/x', outside: 'pmda', created_at: ago(10 * DAY),
    })
    const j = await (await post(lookupRoute.POST, { query: 'セフトリアキソン 偽胆石' })).json()
    expect(j.previous.saved.map((s: { id: string }) => s.id)).toEqual(['s1'])
  })
})

describe('POST /api/trail/outside', () => {
  it('行き先を重ねずに足し、時刻を残す', async () => {
    state.tables.trail_lookups.push({ id: 'L', user_id: 'u1', query: 'q', norm: 'qq', outside: ['pubmed'], times: 1 })
    const id = '00000000-0000-4000-8000-0000000000aa'
    state.tables.trail_lookups[0].id = id
    await post(outsideRoute.POST, { lookupId: id, dest: 'google' })
    await post(outsideRoute.POST, { lookupId: id, dest: 'google' })
    expect(state.tables.trail_lookups[0].outside).toEqual(['pubmed', 'google'])
    expect(state.tables.trail_lookups[0].outside_at).toEqual(expect.any(String))
  })
  it('知らない行き先は400、検索の記録が無ければ書かずに成功', async () => {
    expect((await post(outsideRoute.POST, { dest: 'evil' })).status).toBe(400)
    expect(await (await post(outsideRoute.POST, { dest: 'pubmed' })).json()).toEqual({ ok: true, recorded: false })
  })
})

describe('/api/trail/saves', () => {
  it('残す。出どころはサーバーが決め、よその検索の記録にはつながない', async () => {
    const theirs = '00000000-0000-4000-8000-0000000000bb'
    state.tables.trail_lookups.push({ id: theirs, user_id: 'u2', query: 'x', norm: 'xx' })
    const res = await post(savesRoute.POST, { lookupId: theirs, note: '小児で起きやすい', origin: 'line' })
    expect(res.status).toBe(201)
    expect(state.tables.saved_items[0]).toMatchObject({ user_id: 'u1', lookup_id: null, origin: 'lookup', note: '小児で起きやすい' })
  })
  it('何も無い1件は400で、書かない', async () => {
    const res = await post(savesRoute.POST, { query: '敗血症' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'empty' })
    expect(state.tables.saved_items).toHaveLength(0)
  })
  it('一覧は本人のものだけ、新しい順', async () => {
    state.tables.saved_items.push(
      { id: 'a', user_id: 'u1', origin: 'paste', title: '', note: '古い', body: 'b', created_at: ago(2 * DAY) },
      { id: 'b', user_id: 'u1', origin: 'paste', title: '', note: '新しい', body: 'b', created_at: ago(DAY) },
      { id: 'c', user_id: 'u2', origin: 'paste', title: '', note: 'よそ', body: 'b', created_at: ago(0) },
    )
    const j = await (await savesRoute.GET()).json()
    expect(j.items.map((i: { id: string }) => i.id)).toEqual(['b', 'a'])
  })
  it('消すのは本人の1件だけ', async () => {
    const mine = '00000000-0000-4000-8000-0000000000c1'
    const theirs = '00000000-0000-4000-8000-0000000000c2'
    state.tables.saved_items.push({ id: mine, user_id: 'u1' }, { id: theirs, user_id: 'u2' })
    await savesRoute.DELETE(new Request(`http://x/api/trail/saves?id=${theirs}`, { method: 'DELETE' }))
    await savesRoute.DELETE(new Request(`http://x/api/trail/saves?id=${mine}`, { method: 'DELETE' }))
    expect(state.tables.saved_items.map((r) => r.id)).toEqual([theirs])
    expect((await savesRoute.DELETE(new Request('http://x/api/trail/saves?id=x', { method: 'DELETE' }))).status).toBe(400)
  })
})

describe('DELETE /api/trail/lookups', () => {
  it('本人の検索の記録だけを消し、残したものは消さない', async () => {
    state.tables.trail_lookups.push({ id: 'a', user_id: 'u1' }, { id: 'b', user_id: 'u2' })
    state.tables.saved_items.push({ id: 's', user_id: 'u1' })
    const res = await lookupsRoute.DELETE()
    expect(res.status).toBe(200)
    expect(state.tables.trail_lookups.map((r) => r.id)).toEqual(['b'])
    expect(state.tables.saved_items).toHaveLength(1)
  })
})
