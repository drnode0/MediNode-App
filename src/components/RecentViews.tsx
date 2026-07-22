'use client'
// 「最近見た」リスト。検索タブの空状態（検索語なし）で、最近開いたページへの再訪導線を出す。
// 記録は結果カードのNotionリンククリック時（lib/recent-views.ts）。端末ローカルのみ。
import { useEffect, useState } from 'react'
import { ExternalLink, History } from 'lucide-react'
import { loadRecentViews, clearRecentViews, recordRecentView, type RecentView } from '@/lib/recent-views'
import { recordCqView } from '@/lib/cq-views'
import { useAuth } from '@/components/auth/AuthProvider'

export function RecentViewsList() {
  const { user, loading } = useAuth()
  const [views, setViews] = useState<RecentView[]>([])
  // 認証が解決してから読む＝別ユーザーに変わった直後の再読込で、消去後の空を表示する。
  // （AuthProvider が同じ認証更新の中で先に個人データを消してから user を更新するため、
  //  user.id の変化で再読込すると前アカウントの残りは出ない。）
  useEffect(() => {
    if (loading) return
    setViews(loadRecentViews())
  }, [user?.id, loading])
  if (views.length === 0) return null

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">最近見た</p>
        <button
          onClick={() => {
            clearRecentViews()
            setViews([])
          }}
          className="text-xs text-gray-300 hover:text-gray-500 dark:text-gray-400"
        >
          クリア
        </button>
      </div>
      <div className="space-y-1.5">
        {views.map((v) => (
          <a
            key={v.objectID}
            href={v.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { recordRecentView(v); recordCqView(v.objectID, v.owner) }}
            className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-brand-400 transition-colors"
          >
            <History className="w-3.5 h-3.5 text-gray-300 dark:text-gray-500 shrink-0" />
            <span className="flex-1 truncate">{v.title}</span>
            <ExternalLink className="w-3.5 h-3.5 text-gray-300 dark:text-gray-500 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  )
}
