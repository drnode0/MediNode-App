'use client'
// Web Push のクライアント側購読ロジック（共有ヘルパー）。
// PushPrimer（初回プライマー）と PushSettings（設定内の「この端末で受け取る」ボタン）の両方から使う。
// 失敗は常に静かに reason へ畳み込む（呼び出し側でthrowを気にしなくていい）。

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export type SubscribeResult = {
  ok: boolean
  reason?: 'unsupported' | 'denied' | 'no-key' | 'ios-uninstalled' | 'server-rejected' | 'error'
}

export async function subscribeThisDevice(): Promise<SubscribeResult> {
  try {
    if (isIos() && !isStandalone()) return { ok: false, reason: 'ios-uninstalled' }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, reason: 'unsupported' }
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, reason: 'denied' }

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!key) return { ok: false, reason: 'no-key' }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, ua: navigator.userAgent }),
    })
    const data = await res.json().catch(() => ({ ok: false }))
    if (res.ok && data?.ok) return { ok: true }
    return { ok: false, reason: 'server-rejected' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

export async function getDeviceSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch {
    return false
  }
}
