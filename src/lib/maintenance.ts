// メンテナンスモードの共有ロジック。
// ★ Edge（proxy.ts）と Node（route handler）の両方から import されるため、
//   node:crypto / next/headers は使わない。署名は Web Crypto、フラグ読取は fetch のみ。

export const MAINTENANCE_BYPASS_COOKIE = 'maint_bypass'
export const MAINTENANCE_FLAG_KEY = 'maintenance'

// メンテ中でも常に通す（＝オーナーがログイン→切替に到達できる）パス。
// 注意: メンテナンスゲートは proxy.ts のページ表示リクエストにのみ効き、proxy の
// config.matcher は /api/* を全て除外している。よって「メンテ中でも API 全般は到達可能」
// ＝これは画面だけの見た目メンテ（view-only）であり、データ遮断ではない（設計意図・仕様どおり）。
// 下の '/api/maintenance' '/api/admin' は、将来 matcher が /api を含めた場合に備えた明示であり、
// クライアント側（MaintenanceGate の isMaintenanceAllowedPath 利用等）での一貫性のために残す。
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

// ── フラグ読取（TTLキャッシュ付き）──
// proxy が毎ページ表示で叩くため、Supabaseへの往復をTTLで間引く。
// ウォームインスタンスではキャッシュヒットでDBアクセスを省略。ON切替は最大 TTL 秒で反映。
const FLAG_TTL_MS = 30_000
let flagCache: { value: boolean; at: number } | null = null

export function __resetMaintenanceFlagCache(): void {
  flagCache = null
}

export async function readMaintenanceFlag(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
}): Promise<boolean> {
  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl = opts?.fetchImpl ?? fetch

  if (flagCache && nowMs - flagCache.at < FLAG_TTL_MS) return flagCache.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return flagCache?.value ?? false // 未設定はフェイルオープン（前回値優先）

  try {
    const res = await fetchImpl(
      `${url}/rest/v1/app_flags?select=value&key=eq.${MAINTENANCE_FLAG_KEY}`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        cache: 'no-store',
      },
    )
    if (!res.ok) return flagCache?.value ?? false
    const rows = (await res.json()) as Array<{ value: boolean }>
    const value = rows.length > 0 ? !!rows[0].value : false
    flagCache = { value, at: nowMs }
    return value
  } catch {
    // ネットワーク不調時は前回値、無ければフェイルオープン（アプリを止めない）。
    return flagCache?.value ?? false
  }
}
