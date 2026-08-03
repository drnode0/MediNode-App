'use client'
// リーダーの「読了」水位＋ブックマークの端末ローカル状態を提供する Context。
// RecentViews と同じ理由で、認証解決後・別ユーザー切替時に再読込する
// （AuthProvider が個人データを消してから user を更新するため、user.id 変化での
//  再読込で前アカウントの残りは出ない）。サーバー同期しない。

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  loadReads,
  recordRead,
  loadBookmarks,
  saveBookmarks,
  clearBookmarks as clearBookmarksStorage,
  toggleBookmark as toggleBookmarkList,
  pushRead,
  touchReread,
  type BookmarkEntry,
} from '@/lib/reader-marks'
import { useAuth } from '@/components/auth/AuthProvider'
import { recordTowerEvent } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'

type ReaderMarksCtx = {
  isRead: (id: string) => boolean
  isBookmarked: (id: string) => boolean
  markRead: (id: string) => void
  toggleBookmark: (entry: BookmarkEntry) => void
  bookmarks: BookmarkEntry[]
  clearBookmarks: () => void
}

const Ctx = createContext<ReaderMarksCtx | null>(null)

const NOOP: ReaderMarksCtx = {
  isRead: () => false,
  isBookmarked: () => false,
  markRead: () => {},
  toggleBookmark: () => {},
  bookmarks: [],
  clearBookmarks: () => {},
}

export function useReaderMarks(): ReaderMarksCtx {
  const v = useContext(Ctx)
  if (!v) return NOOP
  return v
}

export function ReaderMarksProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [reads, setReads] = useState<string[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([])

  useEffect(() => {
    if (loading) return
    setReads(loadReads())
    setBookmarks(loadBookmarks())
  }, [user?.id, loading])

  const markRead = useCallback((id: string) => {
    recordRead(id)
    touchReread(id, new Date().toISOString()) // 読み返しの濃度（歩は積まない・正典§9）
    if (isTowerEnabled()) recordTowerEvent({ id, kind: 'read' }) // 知の塔: 初めて読んだ知識は1歩（重複は台帳側で弾く）
    setReads((prev) => {
      if (prev[0] === id) return prev
      return pushRead(prev, id)
    })
  }, [])

  const toggleBookmarkFn = useCallback((entry: BookmarkEntry) => {
    setBookmarks((prev) => {
      const next = toggleBookmarkList(prev, entry)
      saveBookmarks(next)
      return next
    })
  }, [])

  const clearBookmarks = useCallback(() => {
    clearBookmarksStorage()
    setBookmarks([])
  }, [])

  const isRead = useCallback((id: string) => reads.includes(id), [reads])
  const isBookmarked = useCallback(
    (id: string) => bookmarks.some((e) => e.objectID === id),
    [bookmarks],
  )

  const ctxValue = useMemo<ReaderMarksCtx>(
    () => ({ isRead, isBookmarked, markRead, toggleBookmark: toggleBookmarkFn, bookmarks, clearBookmarks }),
    [isRead, isBookmarked, markRead, toggleBookmarkFn, bookmarks, clearBookmarks],
  )

  return <Ctx.Provider value={ctxValue}>{children}</Ctx.Provider>
}
