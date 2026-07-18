// /api/user-settings の復元応答の分類テスト。
// 「未認証」「サーバー側復元不能」「設定なし」「設定あり」「通信失敗」を取り違えると、
// 設定済みユーザーを再セットアップへ誤誘導する（2026-07-18の実インシデント）。
import { describe, it, expect } from 'vitest'
import { classifyRestoreResponse } from '../restore-outcome'

describe('classifyRestoreResponse', () => {
  it('HTTP失敗・JSON不正・応答なしは network_error', () => {
    expect(classifyRestoreResponse(false, { loggedIn: true })).toBe('network_error')
    expect(classifyRestoreResponse(true, null)).toBe('network_error')
    expect(classifyRestoreResponse(true, undefined)).toBe('network_error')
    expect(classifyRestoreResponse(true, 'html error page')).toBe('network_error')
  })

  it('loggedIn:false は not_authenticated（Cookieがサーバーに届いていない）', () => {
    expect(classifyRestoreResponse(true, { loggedIn: false })).toBe('not_authenticated')
    expect(classifyRestoreResponse(true, { loggedIn: false, reason: 'supabase_not_configured' })).toBe('not_authenticated')
    // loggedIn が欠けた不明応答も、安全側（設定なしと断定しない）に倒す
    expect(classifyRestoreResponse(true, {})).toBe('not_authenticated')
  })

  it('ログイン済みでも reason 付き settings:null は server_error（設定なしと言わない）', () => {
    expect(classifyRestoreResponse(true, { loggedIn: true, settings: null, reason: 'decrypt_failed' })).toBe('server_error')
    expect(classifyRestoreResponse(true, { loggedIn: true, settings: null, reason: 'enc_key_not_configured' })).toBe('server_error')
  })

  it('ログイン済み・reason なし・settings:null だけが no_settings', () => {
    expect(classifyRestoreResponse(true, { loggedIn: true, settings: null })).toBe('no_settings')
  })

  it('settings があれば has_settings', () => {
    expect(classifyRestoreResponse(true, { loggedIn: true, settings: { notionToken: 'x' }, updatedAt: '2026-07-18' })).toBe('has_settings')
  })
})
