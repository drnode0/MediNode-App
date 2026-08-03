import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  addStep, recallKind, recallKindFor, ingestRecords, loadTowerState, saveTowerState,
  recordTowerEvent, markSeen, planReplay, leafSteps, TOWER_KEY, DULL_DAYS,
  type Step, type TowerState,
} from '../tower-steps'
import type { QuizStat } from '../quiz-srs'

// localStorage モック（Node環境）。
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
})
// window モック（Node環境。CustomEvent/EventTargetはNode20に標準搭載）。
vi.stubGlobal('window', new EventTarget())

const at = '2026-08-01T10:00:00.000Z'
const empty: TowerState = { steps: [], lastSeenSteps: 0, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '', levels: {} }
const step = (over: Partial<Step> = {}): Step => ({
  id: 'k1', kind: 'read', at, genre: '循環器', title: '敗血症の初期輸液', ...over,
})

beforeEach(() => localStorage.clear())

describe('addStep: 段階遷移のみが積む', () => {
  it('read/wrote/recall は同じ(id,kind)を二度積まない（同一参照を返す）', () => {
    for (const kind of ['read', 'wrote', 'recall'] as const) {
      const s1 = addStep(empty, step({ kind }))
      expect(s1.steps).toHaveLength(1)
      const s2 = addStep(s1, step({ kind, at: '2026-08-02T10:00:00.000Z' }))
      expect(s2).toBe(s1)
    }
  })
  it('別のkindなら同じidでも積める（1件の知識は複数回塔を伸ばす）', () => {
    let s = addStep(empty, step({ kind: 'read' }))
    s = addStep(s, step({ kind: 'wrote' }))
    s = addStep(s, step({ kind: 'recall' }))
    expect(s.steps).toHaveLength(3)
  })
  it('repolish は同じ日に1回・別の日なら再度積める', () => {
    let s = addStep(empty, step({ kind: 'repolish', at: '2026-08-01T09:00:00.000Z' }))
    const same = addStep(s, step({ kind: 'repolish', at: '2026-08-01T23:00:00.000Z' }))
    expect(same).toBe(s)
    const other = addStep(s, step({ kind: 'repolish', at: '2026-11-01T09:00:00.000Z' }))
    expect(other.steps).toHaveLength(2)
  })
})

describe('recallKind: 想起の遷移判定', () => {
  const nowIso = '2026-08-01T10:00:00.000Z'
  it('初めてのokはrecall', () => {
    expect(recallKind(undefined, nowIso)).toBe('recall')
    const neverOk: QuizStat = { ok: 0, ng: 3, last: '2026-07-01T00:00:00.000Z', lastResult: 'ng' }
    expect(recallKind(neverOk, nowIso)).toBe('recall')
  })
  it('鮮度のあるok持ちはnull（再回答は積まない）', () => {
    const freshOk: QuizStat = { ok: 2, ng: 0, last: '2026-07-20T00:00:00.000Z', lastResult: 'ok' }
    expect(recallKind(freshOk, nowIso)).toBeNull()
  })
  it(`最終申告が${DULL_DAYS}日以上前ならrepolish（くすみからの磨き直し）`, () => {
    const stale: QuizStat = { ok: 2, ng: 0, last: '2026-04-01T00:00:00.000Z', lastResult: 'ok' }
    expect(recallKind(stale, nowIso)).toBe('repolish')
  })
  it('直近ngからのokは積まない（まだ→覚えたの連打対策）', () => {
    const recentNg: QuizStat = { ok: 3, ng: 1, last: '2026-07-31T00:00:00.000Z', lastResult: 'ng' }
    expect(recallKind(recentNg, nowIso)).toBeNull()
  })
})

describe('ingestRecords: 書いたのバックフィル', () => {
  const hit = (over: Record<string, unknown> = {}) => ({
    objectID: 'r1', title: 'Aライン確保のコツ', genre: '循環器',
    createdAt: '2026-05-01T00:00:00.000Z', owner: 'personal', ...over,
  })
  it('自分のレコードがwroteとして作成日で積まれる', () => {
    const s = ingestRecords(empty, [hit()])
    expect(s.steps).toHaveLength(1)
    expect(s.steps[0]).toMatchObject({ id: 'r1', kind: 'wrote', at: '2026-05-01T00:00:00.000Z' })
  })
  it('personal以外（team・サブスク）は積まない・既知のidは増えない・createdAt欠損は積まない', () => {
    expect(ingestRecords(empty, [hit({ owner: 'team' })]).steps).toHaveLength(0)
    expect(ingestRecords(empty, [hit({ owner: 'subscription' })]).steps).toHaveLength(0)
    const s = ingestRecords(empty, [hit()])
    const again = ingestRecords(s, [hit()])
    expect(again).toBe(s)
    expect(ingestRecords(empty, [hit({ createdAt: '' })]).steps).toHaveLength(0)
  })
})

describe('storage往復とmarkSeen', () => {
  it('save→loadで往復し、壊れたJSONは空に戻る', () => {
    const s = addStep(empty, step())
    saveTowerState(s)
    expect(loadTowerState().steps).toHaveLength(1)
    localStorage.setItem(TOWER_KEY, '{broken')
    expect(loadTowerState().steps).toHaveLength(0)
  })
  it('markSeenは指定した水位まで記録する', () => {
    const s = addStep(empty, step())
    const seen = markSeen(s, s.steps.length)
    expect(seen.lastSeenSteps).toBe(1)
  })
  it('recordTowerEventはCustomEventを発火し、重複時は発火しない', () => {
    let fired = 0
    const on = () => fired++
    window.addEventListener('medinode:tower-step', on)
    recordTowerEvent({ id: 'e1', kind: 'read', title: 'テスト' })
    recordTowerEvent({ id: 'e1', kind: 'read', title: 'テスト' })
    window.removeEventListener('medinode:tower-step', on)
    expect(fired).toBe(1)
    expect(loadTowerState().steps).toHaveLength(1)
  })
})

const mkStep = (i: number): Step => ({ id: `s${i}`, kind: 'read', at: '2026-08-01T00:00:00.000Z', genre: '', title: '' })
const mkState = (count: number, seen: number): TowerState => ({
  steps: Array.from({ length: count }, (_, i) => mkStep(i)),
  lastSeenSteps: seen, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '', levels: {},
})

describe('markSeen(state, uptoCount)', () => {
  it('見せたところまでだけseenにする（全件ではなく）', () => {
    const s = markSeen(mkState(10, 3), 7)
    expect(s.lastSeenSteps).toBe(7)
    expect(s.lastSeenAt).not.toBe('')
  })
  it('steps数を超える値は丸める・後退はしない', () => {
    expect(markSeen(mkState(5, 2), 99).lastSeenSteps).toBe(5)
    expect(markSeen(mkState(5, 4), 1).lastSeenSteps).toBe(4)
  })
})

describe('生まれ直し（§7: 地下の歩は再追加を塞がない）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  const buried = (kind: Step['kind']) => step({ kind, at: '2026-07-01T00:00:00.000Z' })

  it('地下に同じ(id,kind)があっても、地上の歩は積める（読み返しで生まれ直す）', () => {
    const base: TowerState = { ...empty, joinedAt: joined, steps: [buried('read')] }
    const s = addStep(base, step({ kind: 'read', at: '2026-08-02T00:00:00.000Z' }))
    expect(s.steps).toHaveLength(2)
  })
  it('地上に生まれ直した後は、地上では一生に1回のまま', () => {
    const base: TowerState = { ...empty, joinedAt: joined, steps: [buried('read')] }
    const s1 = addStep(base, step({ kind: 'read', at: '2026-08-02T00:00:00.000Z' }))
    const s2 = addStep(s1, step({ kind: 'read', at: '2026-08-03T00:00:00.000Z' }))
    expect(s2).toBe(s1)
  })
  it('地下に落ちる候補（持ち込みの再取込）は全歩に対して一生に1回のまま', () => {
    // これを緩めると、検索のたびに同じwroteが地下へ積み重なる
    const base: TowerState = { ...empty, joinedAt: joined, steps: [buried('wrote')] }
    const s = addStep(base, step({ kind: 'wrote', at: '2026-07-02T00:00:00.000Z' }))
    expect(s).toBe(base)
  })
  it('joinedAtが無い（旧データ・devハーネス）なら従来どおり全歩で判定', () => {
    const base: TowerState = { ...empty, steps: [step({ kind: 'read' })] }
    const s = addStep(base, step({ kind: 'read', at: '2026-08-02T00:00:00.000Z' }))
    expect(s).toBe(base)
  })
})

describe('recallKindFor（§7: 地下の知識はクイズで思い出すと生まれ直す）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  const NOW = '2026-08-03T00:00:00.000Z'
  const okStat = (lastIso: string): QuizStat => ({ ok: 3, ng: 0, last: lastIso, lastResult: 'ok' })

  it('地上にrecallが無ければ、過去の正解統計があってもrecall（この蔓での初回の即答）', () => {
    const s: TowerState = {
      ...empty, joinedAt: joined,
      steps: [step({ kind: 'recall', at: '2026-07-01T00:00:00.000Z' })], // 地下に沈んだrecall
    }
    expect(recallKindFor(s, 'k1', okStat('2026-07-20T00:00:00.000Z'), NOW)).toBe('recall')
  })
  it('地上にrecall済みなら、従来どおり統計の鮮度でrepolish/nullを判定', () => {
    const s: TowerState = {
      ...empty, joinedAt: joined,
      steps: [step({ kind: 'recall', at: '2026-08-02T00:00:00.000Z' })],
    }
    expect(recallKindFor(s, 'k1', okStat('2026-08-02T00:00:00.000Z'), NOW)).toBeNull()
    expect(recallKindFor(s, 'k1', okStat('2026-04-01T00:00:00.000Z'), NOW)).toBe('repolish')
  })
  it('joinedAtが無くても初回は素直にrecall（新規ユーザーと同じ）', () => {
    expect(recallKindFor(empty, 'k1', undefined, NOW)).toBe('recall')
  })
})

describe('attempt と葉の数（§9）', () => {
  it('leafSteps は attempt を除く', () => {
    const steps: Step[] = [step({ kind: 'wrote' }), step({ id: 'k2', kind: 'attempt' })]
    expect(leafSteps(steps).map((s) => s.kind)).toEqual(['wrote'])
  })
  it('attempt は一生に1回（連打で増えない）', () => {
    const s1 = addStep(empty, step({ kind: 'attempt' }))
    const s2 = addStep(s1, step({ kind: 'attempt', at: '2026-08-02T10:00:00.000Z' }))
    expect(s2).toBe(s1)
  })
  it('attempt はリプレイの葉数に入らない', () => {
    const s: TowerState = { ...empty, steps: [step({ kind: 'attempt' })] }
    expect(planReplay(s)).toEqual({ from: 0, to: 0, play: false })
  })
  it('markSeen は attempt を除いた葉数で丸める', () => {
    const s: TowerState = { ...empty, steps: [step({ kind: 'wrote' }), step({ id: 'k2', kind: 'attempt' })] }
    expect(markSeen(s, 5).lastSeenSteps).toBe(1)
  })
  it('sanitize: levels は既定で空オブジェクト・文字列以外の値は落とす', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({ steps: [], joinedAt: 'x', levels: { a: '💡ナレッジ', b: 7 } }))
    expect(loadTowerState().levels).toEqual({ a: '💡ナレッジ' })
  })
})

describe('地下と水位・リプレイ（§7）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  const old = (id: string) => step({ id, kind: 'wrote', at: '2026-07-01T00:00:00.000Z' })

  it('地下の歩はリプレイに乗せない（toは地上の葉数）', () => {
    const s: TowerState = {
      ...empty, joinedAt: joined,
      steps: [old('u1'), step({ id: 'u1', kind: 'read', at: '2026-08-02T00:00:00.000Z' })],
    }
    expect(planReplay(s)).toEqual({ from: 0, to: 1, play: true })
  })

  it('markSeen は地上の葉数で丸める', () => {
    const s: TowerState = { ...empty, joinedAt: joined, steps: [old('u1'), old('u2')] }
    expect(markSeen(s, 2).lastSeenSteps).toBe(0)
  })

  it('地下の知識がすべて芽を出した瞬間、undergroundClearedAt を一度だけ刻む', () => {
    const base: TowerState = { ...empty, joinedAt: joined }
    let s = addStep(base, old('a'))
    s = addStep(s, old('b'))
    s = addStep(s, step({ id: 'a', kind: 'read', at: '2026-08-02T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('') // bがまだ地下
    s = addStep(s, step({ id: 'b', kind: 'read', at: '2026-08-03T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('2026-08-03T00:00:00.000Z')
  })

  it('持ち込みゼロ（地下なし）では刻まない', () => {
    const s = addStep({ ...empty, joinedAt: joined }, step({ at: '2026-08-02T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('')
  })

  it('一度刻んだら、後から地下に歩が増えても刻み直さない', () => {
    const cleared: TowerState = { ...empty, joinedAt: joined, undergroundClearedAt: '2026-08-03T00:00:00.000Z' }
    let s = addStep(cleared, old('late'))
    s = addStep(s, step({ id: 'late', kind: 'read', at: '2026-08-04T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('2026-08-03T00:00:00.000Z')
  })
})

describe('resolved の検出（§9: ❓CQ→💡ナレッジ）', () => {
  const hit = (level: string) => [{
    objectID: 'cq1', title: '昇圧薬の選択', genre: '循環器',
    createdAt: '2026-07-01T00:00:00.000Z', owner: 'personal', knowledgeLevel: level,
  }]
  const now = '2026-08-02T09:00:00.000Z'

  it('初見が❓CQ→次に💡ナレッジで resolved を1歩積む（atは検出時刻）', () => {
    const s1 = ingestRecords(empty, hit('❓CQ'), now)
    expect(s1.steps.filter((s) => s.kind === 'resolved')).toHaveLength(0)
    expect(s1.levels['cq1']).toBe('❓CQ')
    const s2 = ingestRecords(s1, hit('💡ナレッジ'), '2026-08-03T09:00:00.000Z')
    const resolved = s2.steps.filter((s) => s.kind === 'resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0].at).toBe('2026-08-03T09:00:00.000Z')
    expect(s2.levels['cq1']).toBe('💡ナレッジ')
  })
  it('初見からナレッジなら積まない（遷移を観測していない）', () => {
    const s1 = ingestRecords(empty, hit('💡ナレッジ'), now)
    expect(s1.steps.filter((s) => s.kind === 'resolved')).toHaveLength(0)
  })
  it('二度目のナレッジ観測では積み直さない（(id,resolved)は一生に1回）', () => {
    let s = ingestRecords(empty, hit('❓CQ'), now)
    s = ingestRecords(s, hit('💡ナレッジ'), now)
    s = ingestRecords(s, hit('💡ナレッジ'), now)
    expect(s.steps.filter((k) => k.kind === 'resolved')).toHaveLength(1)
  })
  it('レベル未設定の人には何も起きない・何も溜まらない', () => {
    const s = ingestRecords(empty, [{ objectID: 'x', owner: 'personal', createdAt: '2026-07-01T00:00:00.000Z' }], now)
    expect(s.levels).toEqual({})
    expect(s.steps.every((k) => k.kind === 'wrote')).toBe(true)
  })
})

describe('joinedAt の移行スタンプ', () => {
  it('joinedAtが無い保存データには移行を実行した日を刻み、水位を0へ戻して保存する', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({
      steps: [step()], lastSeenSteps: 1, lastSeenAt: '', backfilledAt: 'x',
    }))
    const s1 = loadTowerState()
    expect(s1.joinedAt).not.toBe('')
    expect(s1.lastSeenSteps).toBe(0)
    const s2 = loadTowerState()
    expect(s2.joinedAt).toBe(s1.joinedAt) // 保存済みなので刻み直さない
  })
  it('undergroundClearedAt は既定で空文字に整形される', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({ steps: [] }))
    expect(loadTowerState().undergroundClearedAt).toBe('')
  })
})

describe('planReplay', () => {
  it('成長があれば再生（from=前回seen, to=現在葉数）', () => {
    expect(planReplay(mkState(10, 6))).toEqual({ from: 6, to: 10, play: true })
  })
  it('成長ゼロなら再生しない', () => {
    expect(planReplay(mkState(6, 6))).toEqual({ from: 6, to: 6, play: false })
  })
  it('seenが葉数を上回る壊れデータでも安全（from=to・再生なし）', () => {
    expect(planReplay(mkState(4, 9))).toEqual({ from: 4, to: 4, play: false })
  })
})
