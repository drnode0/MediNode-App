'use client'

// 起動時のメンテナンスチェック。PWA/Service Worker のキャッシュから起動して proxy を
// 経由しなかったユーザーにも、キャッシュ画面の上にオーバーレイで調整中画面を必ず出す。
// オーナー（isAdmin）には出さない（同時にGETの副作用で通行cookieが付与される）。

import { useEffect, useState } from 'react'
import MaintenanceScreen from '@/components/MaintenanceScreen'

export function MaintenanceGate() {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/maintenance', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { maintenance?: boolean; isAdmin?: boolean } | null) => {
        if (cancelled || !data) return
        setBlocked(!!data.maintenance && !data.isAdmin)
      })
      .catch(() => {
        // 取得失敗時はフェイルオープン（通常アプリを妨げない）。
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!blocked) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-50 overflow-auto">
      <MaintenanceScreen />
    </div>
  )
}
