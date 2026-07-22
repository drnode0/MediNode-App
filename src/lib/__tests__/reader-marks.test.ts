import { describe, it, expect } from 'vitest'
import {
  pushRead, toggleBookmark, isBookmarked, sanitizeReads, sanitizeBookmarks,
  MAX_READS, MAX_BOOKMARKS, type BookmarkEntry,
} from '../reader-marks'

const bm = (id: string): BookmarkEntry => ({
  objectID: id, title: `T${id}`, notionUrl: `https://n/${id}`, at: '2026-07-23T00:00:00.000Z',
})

describe('pushRead', () => {
  it('先頭追加・重複を引き上げ・上限で切り捨て', () => {
    expect(pushRead(['a'], 'b')).toEqual(['b', 'a'])
    expect(pushRead(['a', 'b'], 'b')).toEqual(['b', 'a'])
    let l: string[] = []
    for (let i = 0; i < MAX_READS + 3; i++) l = pushRead(l, String(i))
    expect(l).toHaveLength(MAX_READS)
    expect(l.includes('0')).toBe(false)
  })
})

describe('toggleBookmark / isBookmarked', () => {
  it('無ければ追加、あれば除去', () => {
    const added = toggleBookmark([], bm('a'))
    expect(added.map((e) => e.objectID)).toEqual(['a'])
    expect(isBookmarked(added, 'a')).toBe(true)
    const removed = toggleBookmark(added, bm('a'))
    expect(removed).toEqual([])
    expect(isBookmarked(removed, 'a')).toBe(false)
  })
  it('追加は先頭・上限で切り捨て', () => {
    let l: BookmarkEntry[] = []
    for (let i = 0; i < MAX_BOOKMARKS + 2; i++) l = toggleBookmark(l, bm(String(i)))
    expect(l).toHaveLength(MAX_BOOKMARKS)
    expect(l[0].objectID).toBe(String(MAX_BOOKMARKS + 1))
  })
})

describe('sanitize', () => {
  it('reads は文字列配列のみ', () => {
    expect(sanitizeReads(['a', 1, null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizeReads('x')).toEqual([])
  })
  it('bookmarks は必須フィールドを検証', () => {
    expect(sanitizeBookmarks([bm('a'), { objectID: 'x' }, null])).toEqual([bm('a')])
    expect(sanitizeBookmarks('x')).toEqual([])
  })
})
