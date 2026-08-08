// 「解決した」を押してから同期が追いつくまで泡を伏せる控えのテスト。
// localStorage は本物を使わず、最小のスタブを window に差して確かめる。
import { describe, it, expect, beforeEach, afterAll } from 'vitest'

const store = new Map<string, string>()
const stub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
const hadWindow = 'window' in globalThis
;(globalThis as unknown as { window: unknown }).window = { localStorage: stub }

const { readLocallyResolved, markLocallyResolved, unmarkLocallyResolved } = await import(
  '../locally-resolved'
)

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => store.clear())
afterAll(() => {
  if (!hadWindow) delete (globalThis as unknown as { window?: unknown }).window
})

describe('locally-resolved', () => {
  it('押した分を伏せる', () => {
    markLocallyResolved('personal_a')
    expect(readLocallyResolved().has('personal_a')).toBe(true)
  })

  it('「元に戻す」で伏せるのをやめる', () => {
    markLocallyResolved('personal_a')
    unmarkLocallyResolved('personal_a')
    expect(readLocallyResolved().has('personal_a')).toBe(false)
  })

  it('期限を過ぎた控えは落とす（同期が回れば要らなくなる）', () => {
    const now = Date.now()
    markLocallyResolved('old', now - 61 * DAY)
    markLocallyResolved('fresh', now - 1 * DAY)
    const live = readLocallyResolved(now)
    expect(live.has('old')).toBe(false)
    expect(live.has('fresh')).toBe(true)
  })

  it('壊れた保存値でも落ちない', () => {
    store.set('medinode_locally_resolved_v1', 'not json')
    expect(readLocallyResolved().size).toBe(0)
  })

  it('空のIDは控えない', () => {
    markLocallyResolved('')
    expect(readLocallyResolved().size).toBe(0)
  })
})
