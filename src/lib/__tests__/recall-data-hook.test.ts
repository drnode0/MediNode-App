import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import type { RecallStore } from '@/components/recall/RecallProvider'

// このファイルはもともと useRecallData が取得・保存の両方を自前で持っていた頃のテストだった。
// Task 5 で取得・保存は RecallProvider へ移り、useRecallData は「導出だけ」の担当になった。
// 取得の順番を守る門（読み込み中の保存が巻き戻らない）・404の静かな空扱い・打ち切りは、
// いまは Provider の内部にあり、コンポーネントを描画できないこの vitest 環境（jsdom も
// testing-library も無い）からは検査できない。
//   - 「巻き戻らない」「元配列を壊さない」の性質は src/lib/__tests__/recall-optimistic.test.ts が
//     純関数として検査している
//   - 「404で静かに空」「keep/review の失敗が読む画面へ伝わる」は実機確認で見る
//     （docs/superpowers/plans/2026-09-03-reader-keep-and-read-plan.md の Task 10・項目9/12）
// このファイルに残すのは、useRecallData 自身が持つ導出ロジック（配置・状態・候補・期限・内訳）
// の検査。useRecallStore をモックして claims/progress/reads を直接渡す。

// React の最小版（このファイル専用）。useState / useRef / useMemo / useCallback / useEffect を
// 1コンポーネント分だけ持つ。DOM を持ち込まずに、実物の hook をそのまま動かして検査するために置く。
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

// useRecallStore をモックする。テストごとに store の中身を差し替えられるよう、
// 呼ばれるたびに現在の storeRef の中身を返す薄いプロキシにする。
const storeRef = vi.hoisted(() => ({ current: null as unknown as RecallStore }))
vi.mock('@/components/recall/RecallProvider', () => ({
  useRecallStore: () => storeRef.current,
}))

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
  holes: [[4, 11]], clozeStatus: 'approved', active: true, keywords: '',
})

function makeStore(over: Partial<RecallStore> = {}): RecallStore {
  return {
    enabled: true, loading: false, error: null, saveError: null, clearSaveError: () => {},
    claims: [], progress: [], reads: [], pending: new Set(),
    keep: vi.fn(), review: vi.fn(), markSectionRead: vi.fn(), refresh: vi.fn(),
    ...over,
  }
}

afterEach(() => { R.unmount(); vi.useRealTimers() })

describe('useRecallData の導出', () => {
  // M1: 操作がなくても時計は進む。放っておいても期限切れに変わる。
  it('操作しなくても、時間が経てば期限切れに変わる', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
      const p = { ...prog('c1', 1), dueAt: new Date(Date.now() + 30_000).toISOString() }
      storeRef.current = makeStore({ claims: [claim('c1')], progress: [p] })
      const get = R.mount(() => useRecallData())
      await vi.advanceTimersByTimeAsync(1)
      expect(get().nextDue?.overdue).toBe(false)
      await vi.advanceTimersByTimeAsync(61_000)
      expect(get().nextDue?.overdue).toBe(true)
    } finally { vi.useRealTimers() }
  })

  // 同期でページが外れると、記録だけが残って主張が無い状態になる。数に入れると
  // 「いま確かめる主張はありません」と「期限が来ている主張が N 件」が同時に出る。
  it('画面で開けない主張の記録は、期限にも候補にも数えない', () => {
    const overdue = { ...prog('gone', 1), dueAt: '2000-01-01T00:00:00.000Z' }
    storeRef.current = makeStore({ claims: [claim('c1')], progress: [overdue] })
    const get = R.mount(() => useRecallData())
    expect(get().nextDue).toBeNull()
    expect(get().candidates).toEqual([])
  })

  it('claims が空のときは静かに空の内訳を返す（404 の受け皿）', () => {
    storeRef.current = makeStore({ claims: [], progress: [], reads: [] as RecallSectionRead[] })
    const get = R.mount(() => useRecallData())
    expect(get().loading).toBe(false)
    expect(get().error).toBeNull()
    expect(get().claims).toEqual([])
    expect(get().counts).toEqual({ kept: 0, touched: 0, cold: 0, settled: 0 })
  })

  it('keep・review・refresh は Provider の実装をそのまま呼び出し口として渡す', () => {
    const store = makeStore()
    storeRef.current = store
    const get = R.mount(() => useRecallData())
    expect(get().keep).toBe(store.keep)
    expect(get().review).toBe(store.review)
    expect(get().refresh).toBe(store.refresh)
  })
})
