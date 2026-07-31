import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  nextScale,
  getReaderFontScale,
  setReaderFontScale,
  READER_FONT_SCALE_KEY,
  SCALE_EM,
} from '../reader-font-scale'

// window.localStorage モック（Node環境・personal-data.test.ts と同じ流儀）。
const store = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
vi.stubGlobal('window', { localStorage: localStorageMock })
vi.stubGlobal('localStorage', localStorageMock)

describe('reader-font-scale', () => {
  beforeEach(() => {
    store.clear()
  })

  it('標準→大→特大→標準 と巡回する', () => {
    expect(nextScale('std')).toBe('lg')
    expect(nextScale('lg')).toBe('xl')
    expect(nextScale('xl')).toBe('std')
  })

  it('未保存・不正値は標準に倒す', () => {
    expect(getReaderFontScale()).toBe('std')
    store.set(READER_FONT_SCALE_KEY, 'huge')
    expect(getReaderFontScale()).toBe('std')
  })

  it('保存した値を読み戻せる', () => {
    setReaderFontScale('xl')
    expect(getReaderFontScale()).toBe('xl')
    expect(store.get(READER_FONT_SCALE_KEY)).toBe('xl')
  })

  it('スケールは標準1em基準の拡大のみ（縮小しない）', () => {
    expect(SCALE_EM.std).toBe('1em')
    for (const v of Object.values(SCALE_EM)) {
      expect(parseFloat(v)).toBeGreaterThanOrEqual(1)
    }
  })
})
