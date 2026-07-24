'use client'

// プレミアム決済まわりの共有部品。
// SubscriptionPromoPanel（page.tsx・初期バンドル）と SettingsPanel（遅延読込）の両方から
// 使われるため、SettingsPanel 本体から分離している（page.tsx が SettingsPanel.tsx を
// 静的importすると遅延分割が無効になるため）。

import { useState, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'

// プレミアム決済を開始する共通ヘルパ（POST → Stripe Checkout へリダイレクト）。
// SubscriptionPromoPanel / SettingsPanel の既存 handleCheckout と同じ挙動。成功時は遷移するため
// 返らない。失敗時のみ { ok:false, error } を返す（呼び出し側でメッセージ表示）。
export async function startPremiumCheckout(userId?: string): Promise<{ ok: false; error: string } | void> {
  try {
    const res = await fetch('/api/premium/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    if (!res.ok || !data.url) return { ok: false, error: data.error || '購入ページを開けませんでした' }
    window.location.href = data.url
  } catch {
    return { ok: false, error: 'ネットワークエラーが発生しました' }
  }
}

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
