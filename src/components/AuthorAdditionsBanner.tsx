'use client'

// ============================================================
// 筆者追加分の件数ダイジェスト（一行バナー）
// ------------------------------------------------------------
// プレミアム配信に新しいナレッジ・精読ノートが増えたことを件数だけで知らせる。
// ユーザー投稿の解決通知（ResolvedCqBanner・紫）より一段控えめに徹する：
//   - タイトルは列挙しない（件数のみ・グレー基調の一行）
//   - 表示条件は lib/author-additions.ts の shouldShowAuthorDigest
//     （2件以上・7日に1回まで・CQバナーと同時に出さない）
//   - 表示した時点で頻度制限のスタンプを押す（×されなくても7日は出さない）
// タップで新着タブへ。既読化（水位更新）は新着タブを開いた側で行う。
// ============================================================

import { useEffect, useState } from 'react'
import { X, BookOpen } from 'lucide-react'
import {
  additionsLabel,
  markAuthorDigestShown,
  shouldShowAuthorDigest,
  type AuthorAdditions,
} from '@/lib/author-additions'

export function AuthorAdditionsBanner({
  additions,
  onOpenRecent,
}: {
  additions: AuthorAdditions | null
  onOpenRecent: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // 新着タブを開くと親が additions を null にする → バナーも引っ込む
    if (!additions) { setVisible(false); return }
    if (!shouldShowAuthorDigest(additions)) return
    markAuthorDigestShown()
    setVisible(true)
  }, [additions])

  if (!visible || !additions) return null

  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
        <span className="shrink-0 text-teal-600 dark:text-teal-300"><BookOpen className="h-4 w-4" /></span>
        <button
          onClick={() => { setVisible(false); onOpenRecent() }}
          className="flex-1 min-w-0 text-left text-xs text-gray-600 dark:text-gray-300 leading-relaxed"
        >
          プレミアムに、{additionsLabel(additions)}が追加されています。
          <span className="ml-1 font-semibold text-teal-700 dark:text-teal-300">新着を見る</span>
        </button>
        <button
          onClick={() => setVisible(false)}
          className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 shrink-0 p-1 -m-1"
          title="閉じる"
          aria-label="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
