'use client'

// プレミアム決済まわりの共有部品。
// SubscriptionPromoPanel（page.tsx・初期バンドル）と SettingsPanel（遅延読込）の両方から
// 使われるため、SettingsPanel 本体から分離している（page.tsx が SettingsPanel.tsx を
// 静的importすると遅延分割が無効になるため）。

import { useState, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'

// 決済環境の状態（テストモードか）を取得する共通フック。
// Stripe Secret Key が sk_test_ のときだけ testMode=true。ライブ化すると自動で false。
export function usePremiumPaymentMode() {
  const [mode, setMode] = useState<{ enabled: boolean; testMode: boolean; portalUrl: string } | null>(null)
  useEffect(() => {
    let active = true
    fetch('/api/premium/checkout')
      .then((r) => r.json())
      .then((d) => { if (active) setMode({ enabled: !!d.enabled, testMode: !!d.testMode, portalUrl: typeof d.portalUrl === 'string' ? d.portalUrl : '' }) })
      .catch(() => { if (active) setMode(null) })
    return () => { active = false }
  }, [])
  return mode
}

// テスト決済中であることをモニター向けに明示するバナー。
export function TestModeNotice() {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><FlaskConical className="h-4 w-4 shrink-0" />これはテスト決済です</p>
      <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mt-0.5">
        現在は体験用のテストモードのため、<strong>実際の課金は発生しません</strong>。
        決済画面ではテストカード番号「4242 4242 4242 4242」（有効期限は任意の未来日付・CVCは任意の3桁）をご利用ください。
      </p>
    </div>
  )
}
