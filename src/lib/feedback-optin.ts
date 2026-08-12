// 体験終了アンケートの「拡充通知希望」オプトインの追いPOSTを守る署名トークン。
//
// 流れ: /api/feedback/submit が exit の送信成功時に { pageId, ts, sig } を返す →
// 締め画面でチェックされたときだけ /api/feedback/optin へ返送 → サーバーが署名を
// 検証してそのページのcheckboxを立てる。
//
// 署名があることで、サーバーを無状態に保ったまま「自分が直近（60分内）に発行した
// ページIDにしか書けない」を保証する（任意ページの書き換え・他人の回答の改変を防ぐ）。
// 鍵は FEEDBACK_NOTION_TOKEN（サーバー専用env）を流用し、新しいsecretを増やさない。
// このファイルは Node crypto を使うサーバー専用。クライアントから import しない。

import { createHmac, timingSafeEqual } from 'crypto'

export const OPTIN_TOKEN_TTL_MS = 60 * 60_000

// 発行時刻より未来のtsを名乗る入力の許容ずれ（サーバー間の時計ずれ想定）。
const CLOCK_SKEW_MS = 60_000

export function signOptinToken(pageId: string, ts: number, secret: string): string {
  return createHmac('sha256', secret).update(`${pageId}.${ts}`).digest('hex')
}

export function verifyOptinToken(
  input: { pageId: string; ts: number; sig: string },
  secret: string,
  now: number,
): boolean {
  const { pageId, ts, sig } = input
  if (!pageId || !sig || !Number.isFinite(ts)) return false
  if (now - ts > OPTIN_TOKEN_TTL_MS) return false
  if (ts - now > CLOCK_SKEW_MS) return false
  const expected = signOptinToken(pageId, ts, secret)
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
