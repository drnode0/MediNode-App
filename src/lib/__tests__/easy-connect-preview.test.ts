import { describe, it, expect } from 'vitest'
import {
  PREVIEW_COOKIE,
  previewActionFromSearch,
  isRegisterFirstEnabled,
} from '../easy-connect-preview'
import { isEasyConnectVisible } from '../easy-connect-flag'

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

describe('GA（NEXT_PUBLIC_EASY_CONNECT_GA）', () => {
  it('ga指定では常に登録先行（?preview=off でも戻らない）', () => {
    expect(isRegisterFirstEnabled({ ga: true })).toBe(true)
    expect(isRegisterFirstEnabled({ ga: true, search: '?preview=off', cookie: '' })).toBe(true)
  })
  it('ga=false なら従来どおりCookie/URL判定', () => {
    expect(isRegisterFirstEnabled({ ga: false })).toBe(false)
    expect(isRegisterFirstEnabled({ ga: false, cookie: `${PREVIEW_COOKIE}=1` })).toBe(true)
  })
  it('isEasyConnectVisible は GA env で同期値なしでも true', () => {
    const prev = process.env.NEXT_PUBLIC_EASY_CONNECT_GA
    process.env.NEXT_PUBLIC_EASY_CONNECT_GA = 'true'
    try {
      expect(isEasyConnectVisible()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_EASY_CONNECT_GA
      else process.env.NEXT_PUBLIC_EASY_CONNECT_GA = prev
    }
  })
})
