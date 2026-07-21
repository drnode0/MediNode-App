import { describe, it, expect } from 'vitest'
import { suggestEmailCorrection } from '@/lib/email-typo'

describe('suggestEmailCorrection', () => {
  it('正しい主要ドメインは提案しない', () => {
    expect(suggestEmailCorrection('taro@gmail.com')).toBeNull()
    expect(suggestEmailCorrection('taro@yahoo.co.jp')).toBeNull()
    expect(suggestEmailCorrection('taro@icloud.com')).toBeNull()
    expect(suggestEmailCorrection('taro@docomo.ne.jp')).toBeNull()
  })

  it('ドメイン名のスペルミスを修正提案する', () => {
    expect(suggestEmailCorrection('taro@gmial.com')).toBe('taro@gmail.com')
    expect(suggestEmailCorrection('taro@gmai.com')).toBe('taro@gmail.com')
    expect(suggestEmailCorrection('taro@hotmial.com')).toBe('taro@hotmail.com')
    expect(suggestEmailCorrection('taro@yahooo.co.jp')).toBe('taro@yahoo.co.jp')
  })

  it('TLDのタイポ（.con / .co / .comm 等）を修正提案する', () => {
    expect(suggestEmailCorrection('taro@gmail.con')).toBe('taro@gmail.com')
    expect(suggestEmailCorrection('taro@gmail.co')).toBe('taro@gmail.com')
    expect(suggestEmailCorrection('taro@gmail.comm')).toBe('taro@gmail.com')
  })

  it('大文字や前後空白は正規化してから判定する', () => {
    expect(suggestEmailCorrection('  Taro@GMIAL.com ')).toBe('Taro@gmail.com')
    expect(suggestEmailCorrection('taro@Gmail.com')).toBeNull()
  })

  it('主要ドメインと無関係な独自ドメインには提案しない（誤爆しない）', () => {
    expect(suggestEmailCorrection('taro@keio.jp')).toBeNull()
    expect(suggestEmailCorrection('info@my-clinic.or.jp')).toBeNull()
    expect(suggestEmailCorrection('a@b.co')).toBeNull()
  })

  it('形式が壊れた入力には提案しない（@なし・ドメインなし）', () => {
    expect(suggestEmailCorrection('taro')).toBeNull()
    expect(suggestEmailCorrection('taro@')).toBeNull()
    expect(suggestEmailCorrection('')).toBeNull()
  })
})
