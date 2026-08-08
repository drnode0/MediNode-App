import { describe, it, expect } from 'vitest'
import { isEcReturnFresh, EC_RETURN_FRESH_MS } from '../ec-return'

describe('isEcReturnFresh', () => {
  it('1時間以内は有効', () => {
    expect(isEcReturnFresh(1000, 1000 + EC_RETURN_FRESH_MS - 1)).toBe(true)
  })
  it('1時間ちょうどで無効（claim猶予に合わせる）', () => {
    expect(isEcReturnFresh(1000, 1000 + EC_RETURN_FRESH_MS)).toBe(false)
  })
  it('未来の時刻（時計ずれ）は無効', () => {
    expect(isEcReturnFresh(2000, 1000)).toBe(false)
  })
})
