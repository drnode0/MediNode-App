import { describe, it, expect } from 'vitest'
import { pickLaterTrialEnd } from '@/lib/trial-period'

describe('pickLaterTrialEnd', () => {
  const soon = '2026-08-01T00:00:00.000Z'
  const later = '2026-09-01T00:00:00.000Z'

  it('既存が無ければ候補を採用', () => {
    expect(pickLaterTrialEnd(null, soon)).toBe(soon)
    expect(pickLaterTrialEnd(undefined, soon)).toBe(soon)
  })

  it('既存の方が未来なら既存を保つ（短いコードで縮めない）', () => {
    // note30日（later）中に紹介14日（soon）を入れても縮まない
    expect(pickLaterTrialEnd(later, soon)).toBe(later)
  })

  it('候補の方が未来なら候補を採用（延長・再入力更新）', () => {
    // 自動7日（soon）中にnote30日（later）→ 延長
    expect(pickLaterTrialEnd(soon, later)).toBe(later)
    // 期限切れ後（過去）に同じコード → 今からの候補が勝つ
    expect(pickLaterTrialEnd('2026-07-01T00:00:00.000Z', soon)).toBe(soon)
  })

  it('既存が不正な日付なら候補を採用', () => {
    expect(pickLaterTrialEnd('not-a-date', soon)).toBe(soon)
  })
})
