import { describe, it, expect } from 'vitest'
import { pushRecentView, sanitizeRecentViews, MAX_RECENT_VIEWS, type RecentView } from '../recent-views'

const entry = (id: string, at = '2026-07-21T00:00:00.000Z'): RecentView => ({
  objectID: id,
  title: `タイトル${id}`,
  notionUrl: `https://notion.so/${id}`,
  at,
})

describe('pushRecentView', () => {
  it('先頭に追加される', () => {
    const out = pushRecentView([entry('a')], entry('b'))
    expect(out.map((v) => v.objectID)).toEqual(['b', 'a'])
  })

  it('同じページは重複せず先頭へ引き上げる', () => {
    const out = pushRecentView([entry('a'), entry('b')], entry('b', '2026-07-21T12:00:00.000Z'))
    expect(out.map((v) => v.objectID)).toEqual(['b', 'a'])
    expect(out[0].at).toBe('2026-07-21T12:00:00.000Z')
  })

  it('上限を超えたら古い順に切り捨てる', () => {
    let list: RecentView[] = []
    for (let i = 0; i < MAX_RECENT_VIEWS + 3; i++) {
      list = pushRecentView(list, entry(String(i)))
    }
    expect(list).toHaveLength(MAX_RECENT_VIEWS)
    expect(list[0].objectID).toBe(String(MAX_RECENT_VIEWS + 2))
    expect(list.some((v) => v.objectID === '0')).toBe(false)
  })
})

describe('sanitizeRecentViews', () => {
  it('配列でないJSONは空にする', () => {
    expect(sanitizeRecentViews({ broken: true })).toEqual([])
    expect(sanitizeRecentViews('text')).toEqual([])
    expect(sanitizeRecentViews(null)).toEqual([])
  })

  it('必須フィールドが欠けた要素は除外する', () => {
    const ok = entry('a')
    const out = sanitizeRecentViews([ok, { objectID: 'x' }, null, 42])
    expect(out).toEqual([ok])
  })

  it('上限を超える配列は切り詰める', () => {
    const raw = Array.from({ length: MAX_RECENT_VIEWS + 5 }, (_, i) => entry(String(i)))
    expect(sanitizeRecentViews(raw)).toHaveLength(MAX_RECENT_VIEWS)
  })
})
