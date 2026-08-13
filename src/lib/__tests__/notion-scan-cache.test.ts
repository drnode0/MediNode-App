import { describe, it, expect } from 'vitest'
import { createScanCache, type ScanState } from '../notion-scan-cache'

const state = (n: number, at: number): ScanState<string> => ({
  records: Array.from({ length: n }, (_, i) => `r${i}`),
  cursor: undefined,
  done: true,
  at,
})

describe('createScanCache（シンプルモード検索の走査キャッシュ）', () => {
  it('TTL内は返し、TTLを過ぎたら返さない', () => {
    const c = createScanCache<string>(1000, 10)
    c.set('k', state(3, 0))
    expect(c.get('k', 999)?.records).toHaveLength(3)
    expect(c.get('k', 1000)).toBeNull()
  })

  it('期限切れのエントリは読んだ時点で捨てる（溜め込まない）', () => {
    const c = createScanCache<string>(1000, 10)
    c.set('k', state(3, 0))
    expect(c.size()).toBe(1)
    c.get('k', 5000)
    expect(c.size()).toBe(0)
  })

  it('上限を超えたら古い順に捨てる', () => {
    const c = createScanCache<string>(60_000, 2)
    c.set('a', state(1, 0))
    c.set('b', state(1, 0))
    c.set('c', state(1, 0))
    expect(c.size()).toBe(2)
    expect(c.get('a', 0)).toBeNull()
    expect(c.get('b', 0)).not.toBeNull()
    expect(c.get('c', 0)).not.toBeNull()
  })

  it('同じ鍵に入れ直しても増えず、新しい方が残る', () => {
    const c = createScanCache<string>(60_000, 2)
    c.set('a', state(1, 0))
    c.set('a', state(5, 0))
    expect(c.size()).toBe(1)
    expect(c.get('a', 0)?.records).toHaveLength(5)
  })

  it('入れ直したエントリは「新しい」扱いになり、次の追い出し対象にならない', () => {
    const c = createScanCache<string>(60_000, 2)
    c.set('a', state(1, 0))
    c.set('b', state(1, 0))
    c.set('a', state(2, 0)) // a を触り直す → 最古は b になる
    c.set('c', state(1, 0))
    expect(c.get('a', 0)).not.toBeNull()
    expect(c.get('b', 0)).toBeNull()
  })

  it('未登録の鍵は null', () => {
    const c = createScanCache<string>(60_000, 10)
    expect(c.get('none', 0)).toBeNull()
  })

  it('clear で全部消える', () => {
    const c = createScanCache<string>(60_000, 10)
    c.set('a', state(1, 0))
    c.clear()
    expect(c.size()).toBe(0)
  })
})
