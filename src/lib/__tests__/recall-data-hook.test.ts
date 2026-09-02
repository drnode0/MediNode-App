import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RecallClaim, RecallProgress } from '@/lib/recall/types'

// React の最小版（このファイル専用）。useState / useRef / useMemo / useCallback / useEffect を
// 1コンポーネント分だけ持つ。DOM を持ち込まずに、実物の hook をそのまま動かして
// 「応答が届く順番」を検査するために置いている。
const R = vi.hoisted(() => {
  type Slot = { v?: unknown; current?: unknown; deps?: unknown[]; cleanup?: (() => void) | undefined }
  const st = {
    slots: [] as Slot[], cursor: 0, queue: [] as Array<() => void>,
    render: null as null | (() => unknown), last: undefined as unknown,
    dirty: false, rendering: false, mounted: false,
  }
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  function pass() {
    st.cursor = 0
    st.last = st.render!()
    const q = st.queue; st.queue = []
    for (const f of q) f()
  }
  function run() {
    if (st.rendering) { st.dirty = true; return }
    st.rendering = true
    try { do { st.dirty = false; pass() } while (st.dirty) } finally { st.rendering = false }
  }
  const react = {
    useState(init: unknown) {
      const i = st.cursor++
      if (!(i in st.slots)) st.slots[i] = { v: typeof init === 'function' ? (init as () => unknown)() : init }
      const s = st.slots[i]
      const set = (nv: unknown) => {
        const val = typeof nv === 'function' ? (nv as (p: unknown) => unknown)(s.v) : nv
        if (Object.is(val, s.v)) return
        s.v = val
        if (st.mounted) run()
      }
      return [s.v, set]
    },
    useRef(init: unknown) {
      const i = st.cursor++
      if (!(i in st.slots)) st.slots[i] = { current: init }
      return st.slots[i]
    },
    useMemo(fn: () => unknown, deps?: unknown[]) {
      const i = st.cursor++
      const prev = st.slots[i]
      if (!prev || !same(prev.deps, deps)) st.slots[i] = { deps, v: fn() }
      return st.slots[i].v
    },
    useCallback(fn: unknown, deps?: unknown[]) { return react.useMemo(() => fn, deps) },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const i = st.cursor++
      const prev = st.slots[i]
      if (!prev || !same(prev.deps, deps)) {
        st.slots[i] = { deps, cleanup: prev?.cleanup }
        st.queue.push(() => {
          const s = st.slots[i]
          s.cleanup?.()
          const c = fn()
          s.cleanup = typeof c === 'function' ? c : undefined
        })
      }
    },
  }
  return {
    react,
    mount<T>(fn: () => T): () => T {
      st.slots = []; st.queue = []; st.render = fn as () => unknown; st.mounted = true
      run()
      return () => st.last as T
    },
    unmount() {
      st.mounted = false
      for (const s of st.slots) s?.cleanup?.()
      st.slots = []; st.render = null
    },
  }
})
vi.mock('react', () => R.react)

// mock より後に読む（vi.mock は巻き上げられる）
import { useRecallData } from '@/components/recall/useRecallData'

const prog = (claimId: string, streak: number): RecallProgress => ({
  claimId, keptAt: '2026-09-01T00:00:00.000Z', streak, intervalDays: 3,
  dueAt: '2026-09-04T00:00:00.000Z', lastReviewedAt: '2026-09-01T00:00:00.000Z',
  lastResult: 'ok', okCount: streak, ngCount: 0, removedAt: null,
})
const claim = (claimId: string): RecallClaim => ({
  claimId, pageId: 'p1', pageTitle: '💡 テスト', pageKind: 'knowledge',
  sectionKey: 's1', sectionHeading: 'まとめ', body: '目標は 65 mmHg 以上', source: '出典',
  confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [[4, 11]], clozeStatus: 'approved', active: true,
})
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

afterEach(() => { R.unmount(); vi.unstubAllGlobals() })

describe('useRecallData の反映順', () => {
  // I5: 読み込みの応答が遅れて届いたとき、そのあいだに保存した1件を巻き戻してはいけない。
  it('遅れて届いた古い一覧は、あとから保存した主張を上書きしない', async () => {
    const slow = deferred<void>()
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      if (url === '/api/recall/claims') return res({ claims: [] })
      if (url === '/api/recall/progress') { await slow.promise; return res({ progress: [prog('c1', 0)], reads: [] }) }
      if (url === '/api/recall/keep') return res({ progress: prog('c1', 4) })
      throw new Error(`想定外の呼び出し: ${url}`)
    }))

    const get = R.mount(() => useRecallData())
    await settle()                       // 最初の読み込みが進行中（progress は未着）
    await get().keep('c1', true)         // 先に保存が着地する
    expect(get().progressById.get('c1')?.streak).toBe(4)

    slow.resolve()                       // 古い一覧が遅れて届く
    await settle()
    expect(get().progressById.get('c1')?.streak).toBe(4)
    expect(signals.length).toBeGreaterThan(0)
  })

  it('画面を離れたら進行中の読み込みを打ち切る', async () => {
    const slow = deferred<void>()
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      if (url === '/api/recall/claims') return res({ claims: [] })
      await slow.promise
      return res({ progress: [], reads: [] })
    }))
    R.mount(() => useRecallData())
    await settle(2)
    expect(signals.some((s) => s.aborted)).toBe(false)
    R.unmount()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s.aborted)).toBe(true)
    slow.resolve()
    await settle(2)
  })

  // 保存の失敗は「一度の通信の途切れ」。読み込みの失敗（出すものが無い）と同じ入れ物に入れると、
  // 画面が全面の知らせで覆われ、以後どこも押せなくなる。分けて持つことをここで固定する。
  it('保存に失敗したら saveError に出したうえで投げ返す（読み込みの error は汚さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recall/claims') return res({ claims: [] })
      if (url === '/api/recall/progress') return res({ progress: [], reads: [] })
      return res({}, 500)
    }))
    const get = R.mount(() => useRecallData())
    await settle()
    await expect(get().review('c1', 'ok')).rejects.toThrow('保存に失敗しました')
    expect(get().saveError).toBe('保存に失敗しました')
    expect(get().error).toBeNull()
  })

  it('次に成功した保存で、前の失敗の知らせが消える', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/recall/claims') return res({ claims: [] })
      if (url === '/api/recall/progress') return res({ progress: [], reads: [] })
      return fail ? res({}, 500) : res({ progress: prog('c1', 1) })
    }))
    const get = R.mount(() => useRecallData())
    await settle()
    await expect(get().review('c1', 'ok')).rejects.toThrow()
    expect(get().saveError).toBe('保存に失敗しました')
    fail = false
    await get().review('c1', 'ok')
    expect(get().saveError).toBeNull()
  })

  it('保存は JSON として送る', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url === '/api/recall/claims') return res({ claims: [] })
      if (url === '/api/recall/progress') return res({ progress: [], reads: [] })
      return res({ progress: prog('c1', 1) })
    }))
    const get = R.mount(() => useRecallData())
    await settle()
    await get().keep('c1', true)
    const post = calls.find(([u]) => u === '/api/recall/keep')!
    expect((post[1]?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(post[1]?.body).toBe(JSON.stringify({ claimId: 'c1', keep: true }))
  })

  // M1: 操作がなくても時計は進む。放っておいても期限切れに変わる。
  it('操作しなくても、時間が経てば期限切れに変わる', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
      const p = { ...prog('c1', 1), dueAt: new Date(Date.now() + 30_000).toISOString() }
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (
        url === '/api/recall/claims' ? res({ claims: [claim('c1')] }) : res({ progress: [p], reads: [] })
      )))
      const get = R.mount(() => useRecallData())
      await vi.advanceTimersByTimeAsync(1)
      expect(get().nextDue?.overdue).toBe(false)
      await vi.advanceTimersByTimeAsync(61_000)
      expect(get().nextDue?.overdue).toBe(true)
    } finally { vi.useRealTimers() }
  })

  // 同期でページが外れると、記録だけが残って主張が無い状態になる。数に入れると
  // 「いま確かめる主張はありません」と「期限が来ている主張が N 件」が同時に出る。
  it('画面で開けない主張の記録は、期限にも候補にも数えない', async () => {
    const overdue = { ...prog('gone', 1), dueAt: '2000-01-01T00:00:00.000Z' }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url === '/api/recall/claims' ? res({ claims: [claim('c1')] }) : res({ progress: [overdue], reads: [] })
    )))
    const get = R.mount(() => useRecallData())
    await settle()
    expect(get().nextDue).toBeNull()
    expect(get().candidates).toEqual([])
  })

  it('機能が閉じている（404）ときは静かに空で終える', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(null, 404)))
    const get = R.mount(() => useRecallData())
    await settle()
    expect(get().loading).toBe(false)
    expect(get().error).toBeNull()
    expect(get().claims).toEqual([])
  })
})
