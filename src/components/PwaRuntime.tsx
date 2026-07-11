'use client'

// PWAランタイム: Service Worker の登録＋オフライン状態の表示。
//   - 本番のみ /sw.js を登録（開発中はHMRと干渉するため登録しない）
//   - オフラインになったら画面上部に細いバーで知らせる
//     （アプリシェルはSWキャッシュで起動できるが、検索・同期はできないため）

import { useEffect, useState } from 'react'

export function PwaRuntime() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 登録失敗（プライベートブラウズ等）でもアプリ動作には影響させない。
      })
    }
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null
  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-white text-xs text-center py-1.5 px-3">
      📡 オフラインです — 検索・同期はインターネット接続後にご利用いただけます
    </div>
  )
}
