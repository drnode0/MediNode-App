'use client'

// PWAランタイム: Service Worker の登録＋オフライン状態の表示。
//   - 本番のみ /sw.js を登録（開発中はHMRと干渉するため登録しない）
//   - オフラインになったら画面上部に細いバーで知らせる
//     （アプリシェルはSWキャッシュで起動できるが、検索・同期はできないため）

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export function PwaRuntime() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // 起動スプラッシュ（#medinode-splash）を解除する。この useEffect が動いた＝
    // React のハイドレーションが完了しアプリが操作可能になった時点なので、ここで
    // フェードアウトさせる（スプラッシュは「初回描画〜ハイドレーション」の間だけ出る）。
    // JSが失敗しても閉じ込めないよう、layout.tsx 側のインラインscriptにタイマー保険がある。
    document.documentElement.classList.add('app-ready')

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      // 既にSWが制御中なら、以後の controllerchange は「新バージョンへの更新」を意味する。
      // 初回インストール（controller が無い状態）では clients.claim でも発火するが、
      // その場合はまだ古い画面ではないのでリロードしない（無駄な再読込・ループ防止）。
      const hadController = !!navigator.serviceWorker.controller
      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return
        reloading = true
        // 新SW（新デプロイ）が制御を奪った瞬間に一度だけ再読込し、新しいシェル／チャンクへ差し替える。
        window.location.reload()
      })
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // 起動のたびに sw.js の更新を能動チェック（iOS PWA は放置すると確認が遅い）。
          reg.update().catch(() => {})
        })
        .catch(() => {
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
      <WifiOff className="w-3.5 h-3.5 inline -mt-0.5 mr-1.5" />オフラインです — 検索・同期はインターネット接続後にご利用いただけます
    </div>
  )
}
