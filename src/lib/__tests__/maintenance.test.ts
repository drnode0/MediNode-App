import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isAdminEmail,
  signBypassToken,
  verifyBypassToken,
  isMaintenanceAllowedPath,
  shouldBlockForMaintenance,
} from '@/lib/maintenance'

describe('isAdminEmail', () => {
  beforeEach(() => { process.env.COMP_ADMIN_EMAILS = 'Owner@Example.com, second@example.com' })
  afterEach(() => { delete process.env.COMP_ADMIN_EMAILS })

  it('大文字小文字を無視して一致する', () => {
    expect(isAdminEmail('owner@example.com')).toBe(true)
    expect(isAdminEmail('OWNER@EXAMPLE.COM')).toBe(true)
  })
  it('未登録・空・undefined は false', () => {
    expect(isAdminEmail('nobody@example.com')).toBe(false)
    expect(isAdminEmail('')).toBe(false)
    expect(isAdminEmail(undefined)).toBe(false)
  })
})

describe('bypass token 署名/検証', () => {
  beforeEach(() => { process.env.MAINTENANCE_BYPASS_SECRET = 'test-secret-key' })
  afterEach(() => { delete process.env.MAINTENANCE_BYPASS_SECRET })

  it('署名したトークンは検証を通る', async () => {
    const now = 1_000_000
    const token = await signBypassToken(60_000, now)
    expect(token).toBeTruthy()
    expect(await verifyBypassToken(token, now + 30_000)).toBe(true)
  })
  it('期限切れは false', async () => {
    const now = 1_000_000
    const token = await signBypassToken(60_000, now)
    expect(await verifyBypassToken(token, now + 61_000)).toBe(false)
  })
  it('改ざん・空は false', async () => {
    const token = await signBypassToken(60_000, 1_000_000)
    expect(await verifyBypassToken((token ?? '') + 'x', 1_000_000)).toBe(false)
    expect(await verifyBypassToken(null, 1_000_000)).toBe(false)
    expect(await verifyBypassToken('123.abc', 1_000_000)).toBe(false)
  })
  it('署名鍵が無ければ署名は null・検証は false', async () => {
    delete process.env.MAINTENANCE_BYPASS_SECRET
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await signBypassToken(60_000, 1)).toBe(null)
    expect(await verifyBypassToken('123.abc', 1)).toBe(false)
  })
})

describe('proxy ゲート判定', () => {
  it('許可パスを判定する', () => {
    expect(isMaintenanceAllowedPath('/login')).toBe(true)
    expect(isMaintenanceAllowedPath('/admin/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/api/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/')).toBe(false)
    expect(isMaintenanceAllowedPath('/search')).toBe(false)
  })
  it('メンテON・非オーナー・非許可パスのみブロック', () => {
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/', hasValidBypass: false })).toBe(true)
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/', hasValidBypass: true })).toBe(false)
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/login', hasValidBypass: false })).toBe(false)
    expect(shouldBlockForMaintenance({ maintenance: false, pathname: '/', hasValidBypass: false })).toBe(false)
  })
})
