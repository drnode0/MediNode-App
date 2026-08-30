import { describe, it, expect } from 'vitest'
import { isWithheldFromReaders } from '../subscription-publish-gate'

describe('isWithheldFromReaders', () => {
  it('制作途中（0️⃣〜3️⃣）は読者に出さない', () => {
    expect(isWithheldFromReaders('0️⃣ 下書き')).toBe(true)
    expect(isWithheldFromReaders('1️⃣ 未査読（内容は揃った）')).toBe(true)
    expect(isWithheldFromReaders('2️⃣ ファクト済（1st・合格）')).toBe(true)
    expect(isWithheldFromReaders('3️⃣ 原文照合済')).toBe(true)
  })

  it('公開中の既存ページを消さない', () => {
    // 2026-08-30 実測: サブスクDBは 7️⃣ が24件、6️⃣ が1件。
    // 「7️⃣ だけ載せる」という許可リストにすると 6️⃣ の1枚が読者から消える。
    expect(isWithheldFromReaders('6️⃣ 画像作成済')).toBe(false)
    expect(isWithheldFromReaders('7️⃣ サブスク移行済')).toBe(false)
    expect(isWithheldFromReaders('4️⃣ 図解待ち')).toBe(false)
    expect(isWithheldFromReaders('5️⃣ 図解済')).toBe(false)
  })

  it('ステータスが読めないときは載せる（黙って消えるほうが害が大きい）', () => {
    expect(isWithheldFromReaders('')).toBe(false)
    expect(isWithheldFromReaders(undefined)).toBe(false)
    expect(isWithheldFromReaders('   ')).toBe(false)
    expect(isWithheldFromReaders('未設定')).toBe(false)
  })

  it('先頭の数字絵文字だけを見るのでラベルの文言が変わっても効く', () => {
    expect(isWithheldFromReaders('1️⃣')).toBe(true)
    expect(isWithheldFromReaders('  1️⃣ 別の呼び方に変えた ')).toBe(true)
    // 異体字セレクタ無しの素の「1⃣」も同じ扱いにする
    expect(isWithheldFromReaders('1⃣ 未査読')).toBe(true)
  })

  it('本文中に数字絵文字が出てくるだけのラベルを誤判定しない', () => {
    expect(isWithheldFromReaders('公開済み（1️⃣から昇格）')).toBe(false)
  })
})
