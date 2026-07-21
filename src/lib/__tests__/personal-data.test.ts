// 端末ローカル個人データの「別ユーザーに変わった時だけ消す」ロジックのテスト。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PERSONAL_DEVICE_KEYS,
  LAST_USER_KEY,
  clearPersonalDeviceData,
  reconcilePersonalDataForUser,
} from '../personal-data'

// localStorage モック（Node環境）。
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

// 全キーに値を入れておくヘルパ。
function seedPersonalData() {
  for (const k of PERSONAL_DEVICE_KEYS) store.set(k, 'x')
}

beforeEach(() => store.clear())

describe('clearPersonalDeviceData', () => {
  it('個人データキーを全部消す', () => {
    seedPersonalData()
    clearPersonalDeviceData()
    for (const k of PERSONAL_DEVICE_KEYS) expect(store.has(k)).toBe(false)
  })

  it('LAST_USER_KEY は消さない（持ち主の記録は残す）', () => {
    store.set(LAST_USER_KEY, 'userA')
    seedPersonalData()
    clearPersonalDeviceData()
    expect(store.get(LAST_USER_KEY)).toBe('userA')
  })
})

describe('reconcilePersonalDataForUser', () => {
  it('初回観測（LAST_USER なし）: 記録するだけ・既存データは消さない', () => {
    seedPersonalData()
    const r = reconcilePersonalDataForUser('userA')
    expect(r).toBe('adopted')
    expect(store.get(LAST_USER_KEY)).toBe('userA')
    // デプロイ直後に正規ユーザーのデータを事故で消さないこと。
    for (const k of PERSONAL_DEVICE_KEYS) expect(store.has(k)).toBe(true)
  })

  it('同一ユーザーの再ログイン/トークン更新: 何もしない・データ保持', () => {
    store.set(LAST_USER_KEY, 'userA')
    seedPersonalData()
    const r = reconcilePersonalDataForUser('userA')
    expect(r).toBe('noop')
    for (const k of PERSONAL_DEVICE_KEYS) expect(store.has(k)).toBe(true)
  })

  it('別ユーザーに変わった: 前の持ち主の個人データを消し、持ち主を更新', () => {
    store.set(LAST_USER_KEY, 'userA')
    seedPersonalData()
    const r = reconcilePersonalDataForUser('userB')
    expect(r).toBe('cleared')
    expect(store.get(LAST_USER_KEY)).toBe('userB')
    for (const k of PERSONAL_DEVICE_KEYS) expect(store.has(k)).toBe(false)
  })

  it('null（ログアウト/読み込み中）: 何もしない（持ち主も既存データもそのまま）', () => {
    store.set(LAST_USER_KEY, 'userA')
    seedPersonalData()
    const r = reconcilePersonalDataForUser(null)
    expect(r).toBe('noop')
    expect(store.get(LAST_USER_KEY)).toBe('userA')
    for (const k of PERSONAL_DEVICE_KEYS) expect(store.has(k)).toBe(true)
  })
})
