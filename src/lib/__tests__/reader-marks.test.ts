import { describe, it, expect } from 'vitest'
import {
  pushRead, toggleBookmark, isBookmarked, sanitizeReads, sanitizeBookmarks,
  MAX_READS, MAX_BOOKMARKS, nextReread, type BookmarkEntry,
} from '../reader-marks'

describe('読み返しの濃度（§9: 90日以上あけた再読だけ数える・歩は積まない）', () => {
  it('初読は count 0 で日付だけ持つ', () => {
    expect(nextReread(undefined, '2026-08-01T00:00:00.000Z')).toEqual({ count: 0, lastAt: '2026-08-01T00:00:00.000Z' })
  })
  it('90日未満の再読は日付だけ更新（濃くならない）', () => {
    const r = nextReread({ count: 0, lastAt: '2026-08-01T00:00:00.000Z' }, '2026-09-01T00:00:00.000Z')
    expect(r).toEqual({ count: 0, lastAt: '2026-09-01T00:00:00.000Z' })
  })
  it('90日以上あけた再読で1段濃くなる', () => {
    const r = nextReread({ count: 0, lastAt: '2026-01-01T00:00:00.000Z' }, '2026-08-01T00:00:00.000Z')
    expect(r.count).toBe(1)
  })
  it('3で頭打ち（3段階=1・2・3以上）', () => {
    const r = nextReread({ count: 3, lastAt: '2025-01-01T00:00:00.000Z' }, '2026-08-01T00:00:00.000Z')
    expect(r.count).toBe(3)
  })
})

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
