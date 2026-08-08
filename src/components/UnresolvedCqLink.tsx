'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircleQuestion } from 'lucide-react'
import { loadUnresolvedCqs, readUnresolvedCount, writeUnresolvedCount } from '@/lib/unresolved-cqs'

// ヘッダーから /cq（未解決の問いが浮かぶ画面）への静かな入口。
//
// 未解決が0件なら何も出さない。件数バッジも出さない——数字を常設すると
// 「溜めている」ことを毎回突きつける催促になる。アイコン1つに留める。
//
// 灯り（新しい答えの有無）はここでは調べない。判定は /cq を開いたときだけ行う
// （ヘッダーで毎回まわすと、ホームを開くたびにプレミアム検索を十数回叩くことになる）。

// 起動直後は検索・新着の取得を優先させ、少し遅らせてから調べる。
const DEFER_MS = 1500

export function UnresolvedCqLink() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const cached = readUnresolvedCount()
    if (cached !== null) {
      setCount(cached)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      loadUnresolvedCqs()
        .then((cqs) => {
          if (cancelled) return
          setCount(cqs.length)
          writeUnresolvedCount(cqs.length)
        })
        .catch(() => {
          // 取れなければ入口を出さないだけ。ホームの表示には影響させない。
        })
    }, DEFER_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (count < 1) return null

  return (
    <Link
      href="/cq"
      title="未解決の問い"
      aria-label={`未解決の問い ${count}件`}
      className="w-10 h-10 -my-1 grid place-items-center rounded-xl text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      <MessageCircleQuestion className="w-5 h-5" />
    </Link>
  )
}
