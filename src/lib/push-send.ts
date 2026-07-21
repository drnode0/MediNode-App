// web-push 送信ラッパ。VAPID設定・単一購読への送信・失効(410/404)判定・種別トグル判定。
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserPrefs } from './push-prefs'
import { kindEnabled, type PushKind } from './push'

export type PushPayload = { title: string; body: string; url?: string; tag?: string }

type SubRow = { endpoint: string; p256dh: string; auth: string; user_id: string }

export function classifyWebPushError(err: { statusCode?: number }): 'gone' | 'error' {
  return err?.statusCode === 410 || err?.statusCode === 404 ? 'gone' : 'error'
}

let vapidReady: boolean | null = null
export function configureVapid(): boolean {
  if (vapidReady !== null) return vapidReady
  const pub = process.env.VAPID_PUBLIC_KEY
  const key = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:owner@example.com'
  if (!pub || !key) {
    vapidReady = false
    return false
  }
  webpush.setVapidDetails(subject, pub, key)
  vapidReady = true
  return true
}

export async function sendToEndpoint(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<'ok' | 'gone' | 'error'> {
  if (!configureVapid()) return 'error'
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    )
    return 'ok'
  } catch (err) {
    return classifyWebPushError(err as { statusCode?: number })
  }
}

// 指定ユーザー群へ、各自の種別トグルを尊重して送信。失効購読は revoked_at を立てる。
export async function sendToUsers(
  admin: SupabaseClient,
  userIds: string[],
  kind: PushKind,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid() || userIds.length === 0) return { sent: 0, pruned: 0 }

  // トグルON のユーザーだけに絞る。
  const allowed: string[] = []
  for (const uid of userIds) {
    const prefs = await getUserPrefs(admin, uid)
    if (kindEnabled(prefs, kind)) allowed.push(uid)
  }
  if (allowed.length === 0) return { sent: 0, pruned: 0 }

  const { data, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', allowed)
    .is('revoked_at', null)
  if (error) throw new Error(error.message)
  const subs = (data ?? []) as SubRow[]

  let sent = 0
  let pruned = 0
  for (const s of subs) {
    const r = await sendToEndpoint(s, payload)
    if (r === 'ok') sent++
    else if (r === 'gone') {
      pruned++
      await admin
        .from('push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('endpoint', s.endpoint)
    }
  }
  return { sent, pruned }
}
