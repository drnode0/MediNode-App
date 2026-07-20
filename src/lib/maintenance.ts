// メンテナンスモードの共有ロジック。
// ★ Edge（proxy.ts）と Node（route handler）の両方から import されるため、
//   node:crypto / next/headers は使わない。署名は Web Crypto、フラグ読取は fetch のみ。

export const MAINTENANCE_BYPASS_COOKIE = 'maint_bypass'
export const MAINTENANCE_FLAG_KEY = 'maintenance'

// メンテ中でも常に通す（＝オーナーがログイン→切替に到達できる）パス。
const MAINTENANCE_ALLOWED_PREFIXES = [
  '/login',
  '/auth',
  '/maintenance',
  '/admin',
  '/api/maintenance',
  '/api/admin',
]

// COMP_ADMIN_EMAILS（カンマ区切り）に含まれるか。大文字小文字は無視。
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const admins = (process.env.COMP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(email.toLowerCase())
}

// 通行cookieの署名鍵。専用鍵が無ければサービスロールキー（サーバー専用値）を流用する。
function bypassSecret(): string | null {
  return process.env.MAINTENANCE_BYPASS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

// HMAC-SHA256 → base64url。Web Crypto なので Edge/Node 両対応。
async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 通行トークン = `${expMs}.${hmac(secret, expMs)}`。既定 7 日有効。
export async function signBypassToken(
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  nowMs = Date.now(),
): Promise<string | null> {
  const secret = bypassSecret()
  if (!secret) return null
  const exp = String(nowMs + ttlMs)
  const sig = await hmacBase64Url(secret, exp)
  return `${exp}.${sig}`
}

// トークン検証。期限内かつ署名一致で true。鍵が無ければ常に false。
export async function verifyBypassToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token) return false
  const secret = bypassSecret()
  if (!secret) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < nowMs) return false
  const expected = await hmacBase64Url(secret, exp)
  return expected === sig
}

export function isMaintenanceAllowedPath(pathname: string): boolean {
  return MAINTENANCE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

// proxy のゲート判定（純関数）。メンテON・非オーナー（通行cookie無効）・非許可パスのみブロック。
export function shouldBlockForMaintenance(opts: {
  maintenance: boolean
  pathname: string
  hasValidBypass: boolean
}): boolean {
  if (!opts.maintenance) return false
  if (opts.hasValidBypass) return false
  if (isMaintenanceAllowedPath(opts.pathname)) return false
  return true
}
