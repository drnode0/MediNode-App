'use client'

// PWA関連のカスタムイベント計測（Vercel Analytics）。画面表示は持たない（副作用のみ）。
//
//   - pwa_installed … ホーム画面追加（Android/デスクトップChrome系のみ発火。iOSは
//                      appinstalled イベント非対応のため取れない＝計測値は下限値）
//   - pwa_launch    … PWA（standalone表示）として起動された。セッション中1回だけ送る。
//
// カスタムイベントは Vercel の有料プラン機能。無料（Hobby）プランでは
// 送信してもダッシュボードに出ないだけで、エラーにはならない。

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

export function AnalyticsEvents() {
  useEffect(() => {
    // ホーム画面追加の瞬間を計測。
    const onInstalled = () => track('pwa_installed')
    window.addEventListener('appinstalled', onInstalled)

    // PWAとして起動されたか（standalone = ホーム画面から起動）。
    // タブ切替等の再マウントで重複計上しないよう sessionStorage でセッション1回に制限。
    try {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        // iOS Safari 旧API
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
      if (isStandalone && !sessionStorage.getItem('pwa_launch_tracked')) {
        sessionStorage.setItem('pwa_launch_tracked', '1')
        track('pwa_launch')
      }
    } catch {
      // matchMedia/sessionStorage が使えない環境では何もしない。
    }

    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  return null
}
