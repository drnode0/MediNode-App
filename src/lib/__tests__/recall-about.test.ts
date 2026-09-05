// 「Recall とは」の折りたたみの初期状態。描画はテストできないので、開くかどうかの判断だけを
// 純関数に出してここで見る（設計 2026-09-05 再計画 §3）。
import { describe, it, expect } from 'vitest'
import { aboutOpenInitial, ABOUT_KEY } from '@/lib/recall/about'

describe('Recall とは の開閉', () => {
  it('初めて（保存なし）は開いた状態', () => {
    expect(aboutOpenInitial(null)).toBe(true)
  })

  it("閉じた記録 '0' なら閉じる。'1' なら開く", () => {
    expect(aboutOpenInitial('0')).toBe(false)
    expect(aboutOpenInitial('1')).toBe(true)
  })

  it('壊れた値は開いた扱い（説明を隠すより見せる方が安全）', () => {
    expect(aboutOpenInitial('x')).toBe(true)
    expect(aboutOpenInitial('')).toBe(true)
  })

  it('保存キー', () => {
    expect(ABOUT_KEY).toBe('recall.aboutOpen')
  })
})
