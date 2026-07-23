'use client'
// ブックマーク一覧。検索タブの空状態（検索語なし）で、「最近見た」の隣に再訪導線を出す。
// 記録はアプリ内リーダーの★ボタン（reader/SubscriptionReader.tsx）。端末ローカルのみ。
// タップは外部リンクではなくアプリ内リーダーを開く（useReader().open）。
import { Star } from 'lucide-react'
import { useReaderMarks } from '@/components/reader/ReaderMarksProvider'
import { useReader } from '@/components/reader/SubscriptionReader'
import { prefetchReaderDoc } from '@/lib/reader-prefetch'
import { KnowledgeTitle } from '@/lib/title-display'

export function BookmarksList() {
  const { bookmarks, clearBookmarks } = useReaderMarks()
  const { open } = useReader()
  if (bookmarks.length === 0) return null

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">ブックマーク</p>
        <button
          onClick={() => clearBookmarks()}
          className="text-xs text-gray-300 hover:text-gray-500 dark:text-gray-400"
        >
          クリア
        </button>
      </div>
      <div className="space-y-1.5">
        {bookmarks.map((b) => (
          <button
            key={b.objectID}
            type="button"
            onClick={() => open(b)}
            onPointerEnter={() => prefetchReaderDoc(b.objectID)}
            onFocus={() => prefetchReaderDoc(b.objectID)}
            className="w-full flex items-start gap-2.5 px-3.5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-brand-400 transition-colors text-left"
          >
            <Star className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="currentColor" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium"><KnowledgeTitle title={b.title} /></span>
              {b.summary && (
                <span className="block text-xs text-gray-400 dark:text-gray-500 line-clamp-2 mt-0.5">
                  {b.summary}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
