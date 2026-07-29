'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, TreeDeciduous } from 'lucide-react'
import { CHI_NO_NIWA_TAIJU_URL } from '@/lib/app-links'

// 知の庭「大樹の間」への入口。プレミアムなら /api/garden/link がkey付きURLを返す。
// 取得前・失敗時は素のURL（teaser）で開く。
export default function GardenLink() {
  const [url, setUrl] = useState(CHI_NO_NIWA_TAIJU_URL)
  useEffect(() => {
    let alive = true
    fetch('/api/garden/link')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d && typeof d.url === 'string' && d.url.startsWith('https://chi-no-niwa.vercel.app/')) setUrl(d.url)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-100 dark:ring-brand-800 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors text-left"
    >
      <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-white dark:bg-gray-800 text-brand-600 dark:text-brand-300">
        <TreeDeciduous className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">🌳 知の庭で眺める</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">ここまでの知が、一本の大樹に実っています</p>
      </div>
      <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
    </a>
  )
}
