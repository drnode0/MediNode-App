import { describe, it, expect } from 'vitest'
import {
  PREVIEW_COOKIE,
  previewActionFromSearch,
  isRegisterFirstEnabled,
} from '../easy-connect-preview'

describe('previewActionFromSearch', () => {
  it('?preview=easyconnect で set', () => {
    expect(previewActionFromSearch('?preview=easyconnect')).toBe('set')
  })
  it('?preview=off で clear', () => {
    expect(previewActionFromSearch('?preview=off')).toBe('clear')
  })
  it('他のクエリでは none', () => {
    expect(previewActionFromSearch('?utm_source=x')).toBe('none')
    expect(previewActionFromSearch('')).toBe('none')
    expect(previewActionFromSearch('?preview=tower')).toBe('none')
  })
})

describe('isRegisterFirstEnabled', () => {
  it('Cookieがあれば true', () => {
    expect(isRegisterFirstEnabled({ cookie: `a=1; ${PREVIEW_COOKIE}=1; b=2` })).toBe(true)
  })
  it('同一ロードのURLだけでも true（Cookie保存前でも取りこぼさない）', () => {
    expect(isRegisterFirstEnabled({ search: '?preview=easyconnect', cookie: '' })).toBe(true)
  })
  it('?preview=off はCookieがあっても false（その場で解除される）', () => {
    expect(isRegisterFirstEnabled({ search: '?preview=off', cookie: `${PREVIEW_COOKIE}=1` })).toBe(false)
  })
  it('何も無ければ false', () => {
    expect(isRegisterFirstEnabled({})).toBe(false)
    expect(isRegisterFirstEnabled({ search: '?x=1', cookie: 'other=1' })).toBe(false)
  })
  it('似た名前のCookieを誤検出しない', () => {
    expect(isRegisterFirstEnabled({ cookie: 'xx_mn_ec_preview_old=1' })).toBe(false)
  })
})
