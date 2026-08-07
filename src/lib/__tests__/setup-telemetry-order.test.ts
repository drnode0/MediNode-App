import { describe, it, expect } from 'vitest'
import { STEP_ORDER } from '../setup-telemetry'

describe('STEP_ORDER', () => {
  it('register は entry と start の間にある', () => {
    expect(STEP_ORDER.entry).toBeLessThan(STEP_ORDER.register)
    expect(STEP_ORDER.register).toBeLessThan(STEP_ORDER.start)
  })
  it('既存ステップの前後関係は変わらない', () => {
    const names = ['entry', 'start', 'mode', 'notion', 'algolia', 'sync', 'options']
    const values = names.map((n) => STEP_ORDER[n])
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(values.every((v) => typeof v === 'number')).toBe(true)
  })
})
