'use client'
// 「今日の1問」を初回回答した直後に表示する許可プライマー。
// 自前シートで価値を伝えてから、OK時にだけネイティブ許可を呼ぶ（"あとで"はネイティブ許可を焼かない）。
// iOS Safari 未インストール（standalone でない）時は許可を出せないので案内へ差し替える。
import { useEffect, useState } from 'react'
import { isIos, isStandalone, subscribeThisDevice } from '@/lib/push-client'

const SEEN_KEY = 'medinode_push_primer_seen_v1' // 一度出したら当面出さない

export default function PushPrimer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'ask' | 'ios-install'>('ask')

  useEffect(() => {
    if (open && isIos() && !isStandalone()) setMode('ios-install')
  }, [open])

  if (!open) return null

  const enable = async () => {
    try {
      await subscribeThisDevice()
    } finally {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        {mode === 'ios-install' ? (
          <>
            <p className="text-base font-semibold text-slate-800">明日の1問を受け取るには</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              iPhoneでは、共有メニューから「ホーム画面に追加」でアプリとして開いておくと、通知を受け取れます。
            </p>
            <button onClick={onClose} className="mt-4 w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white">
              わかりました
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-slate-800">明日の1問を通知で受け取りますか？</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              1日1問だけ監修ナレッジからお届けします。通知はいつでも設定からオフにできます。
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-600">
                あとで
              </button>
              <button onClick={enable} className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white">
                受け取る
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function shouldShowPrimer(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return false
    return true
  } catch {
    return false
  }
}

export function markPrimerSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {}
}
