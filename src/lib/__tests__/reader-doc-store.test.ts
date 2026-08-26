import { describe, it, expect } from 'vitest'
import { pickStoredSpread } from '../reader-doc-store'

describe('pickStoredSpread', () => {
  it('保存済みエントリから誌面を取り出す', () => {
    expect(pickStoredSpread({ objectID: 'a', doc: { title: 'x' } as never, spread: { version: 1 } as never, at: 0 })).toEqual({ version: 1 })
  })

  it('誌面を持たない古いエントリでは null を返す', () => {
    expect(pickStoredSpread({ objectID: 'a', doc: { title: 'x' } as never, at: 0 })).toBeNull()
  })

  it('エントリ自体が無ければ null', () => {
    expect(pickStoredSpread(undefined)).toBeNull()
  })
})
