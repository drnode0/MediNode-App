// 暗号化/復号と鍵ローテーション（v2形式・OLDフォールバック・遅延移行判定）のテスト。
import { describe, it, expect, beforeEach } from 'vitest'

const KEY_A = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64')
const KEY_B = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 100)).toString('base64')

// crypto.ts は process.env を読み取り時に参照するため、テストごとに設定し直す。
async function loadCrypto() {
  return await import('../crypto')
}

describe('crypto: 鍵バージョニング', () => {
  beforeEach(() => {
    delete process.env.SETTINGS_ENC_KEY
    delete process.env.SETTINGS_ENC_KEY_OLD
  })

  it('v2: 接頭辞付きで暗号化し、同じ鍵で復号できる', async () => {
    process.env.SETTINGS_ENC_KEY = KEY_A
    const { encryptSettings, decryptSettingsDetailed } = await loadCrypto()
    const enc = encryptSettings('{"secret":"data"}')
    expect(enc.startsWith('v2:')).toBe(true)
    const r = decryptSettingsDetailed(enc)
    expect(r.json).toBe('{"secret":"data"}')
    expect(r.needsReencrypt).toBe(false)
  })

  it('鍵ローテーション: 旧鍵データはOLDで復号でき、needsReencrypt=true', async () => {
    process.env.SETTINGS_ENC_KEY = KEY_A
    const { encryptSettings, decryptSettingsDetailed } = await loadCrypto()
    const encWithA = encryptSettings('{"v":1}')

    process.env.SETTINGS_ENC_KEY = KEY_B
    process.env.SETTINGS_ENC_KEY_OLD = KEY_A
    const r = decryptSettingsDetailed(encWithA)
    expect(r.json).toBe('{"v":1}')
    expect(r.needsReencrypt).toBe(true)
  })

  it('接頭辞なしの旧形式も読め、needsReencrypt=true', async () => {
    process.env.SETTINGS_ENC_KEY = KEY_A
    const { encryptSettings, decryptSettingsDetailed } = await loadCrypto()
    const legacy = encryptSettings('{"v":2}').slice(3) // v2: を剥がして旧形式を再現
    const r = decryptSettingsDetailed(legacy)
    expect(r.json).toBe('{"v":2}')
    expect(r.needsReencrypt).toBe(true)
  })

  it('OLD撤去後は旧鍵データを復号できない（例外）', async () => {
    process.env.SETTINGS_ENC_KEY = KEY_A
    const { encryptSettings } = await loadCrypto()
    const encWithA = encryptSettings('{"v":3}')

    process.env.SETTINGS_ENC_KEY = KEY_B
    delete process.env.SETTINGS_ENC_KEY_OLD
    const { decryptSettingsDetailed } = await loadCrypto()
    expect(() => decryptSettingsDetailed(encWithA)).toThrow()
  })

  it('isCryptoReady: 鍵未設定/不正長でfalse', async () => {
    const { isCryptoReady } = await loadCrypto()
    expect(isCryptoReady()).toBe(false)
    process.env.SETTINGS_ENC_KEY = 'too-short'
    expect(isCryptoReady()).toBe(false)
    process.env.SETTINGS_ENC_KEY = KEY_A
    expect(isCryptoReady()).toBe(true)
  })
})
