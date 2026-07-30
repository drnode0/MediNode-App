import { describe, it, expect, beforeEach } from 'vitest'
import { recordClientError, recentClientErrors, clearClientErrors, CLIENT_ERROR_MAX } from '../client-errors'

beforeEach(() => {
  clearClientErrors()
})

describe('recordClientError', () => {
  it('記録した順（新しいものが先）で返す', () => {
    recordClientError('古いエラー')
    recordClientError('新しいエラー')
    expect(recentClientErrors()[0]).toContain('新しいエラー')
  })

  it('上限を超えたら古いものから捨てる（無限に溜めない）', () => {
    for (let i = 0; i < CLIENT_ERROR_MAX + 5; i++) recordClientError(`err-${i}`)
    expect(recentClientErrors()).toHaveLength(CLIENT_ERROR_MAX)
    expect(recentClientErrors().join()).not.toContain('err-0')
  })

  it('同じエラーの連続は1件にまとめる（同一操作の連打で埋めない）', () => {
    recordClientError('同じエラー')
    recordClientError('同じエラー')
    recordClientError('同じエラー')
    expect(recentClientErrors()).toHaveLength(1)
  })

  it('パスはクエリを落として付ける（検索語を外に出さない）', () => {
    recordClientError('読み込み失敗', '/search?q=%E9%80%A0%E5%BD%B1%E5%89%A4')
    const s = recentClientErrors()[0]
    expect(s).toContain('/search')
    expect(s).not.toContain('q=')
    expect(s).not.toContain('造影')
  })

  it('長いメッセージは切り詰める', () => {
    recordClientError('あ'.repeat(500))
    expect(recentClientErrors()[0].length).toBeLessThanOrEqual(220)
  })

  it('空メッセージは記録しない', () => {
    recordClientError('')
    recordClientError('   ')
    expect(recentClientErrors()).toHaveLength(0)
  })
})
