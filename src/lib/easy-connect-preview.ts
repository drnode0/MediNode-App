// 登録先行（かんたん接続 v2 段C）の画面順序を、このブラウザだけに見せるための鍵。
//
// 設計書 §17 の「2つの鍵」の片方。かんたん接続の機能そのもの（カード・認可・claim）は
// アカウントの easy_connect 機能で閉じており、こちらは画面順序にしか効かない。
// Cookieが漏れても接続はできないため実害がない。
//
// URLとCookieの両方を見るのは、?preview=easyconnect で着地した最初のロードでも
// 画面順序が変わるようにするため（Cookie保存より先に画面が組み上がっても取りこぼさない）。

export const PREVIEW_COOKIE = 'mn_ec_preview'
export const PREVIEW_MAX_AGE_SEC = 30 * 24 * 60 * 60

export function previewActionFromSearch(search: string): 'set' | 'clear' | 'none' {
  try {
    const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('preview')
    if (v === 'easyconnect') return 'set'
    if (v === 'off') return 'clear'
    return 'none'
  } catch {
    return 'none'
  }
}

function hasPreviewCookie(cookie: string): boolean {
  // 名前の完全一致で見る（xx_mn_ec_preview のような別Cookieを拾わない）。
  return cookie
    .split(';')
    .map((c) => c.trim())
    .some((c) => c.startsWith(`${PREVIEW_COOKIE}=`) && c.slice(PREVIEW_COOKIE.length + 1) === '1')
}

export function isRegisterFirstEnabled(input: { search?: string; cookie?: string; ga?: boolean }): boolean {
  // GA後（NEXT_PUBLIC_EASY_CONNECT_GA=true）は全員が登録先行。?preview=off でも
  // 戻さない——GA後の「元の順序」はもう存在せず、Cookieはプレビュー期間の名残でしかない。
  if (input.ga) return true
  const action = previewActionFromSearch(input.search ?? '')
  if (action === 'clear') return false
  if (action === 'set') return true
  return hasPreviewCookie(input.cookie ?? '')
}

export function readPreviewFlagFromBrowser(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  return isRegisterFirstEnabled({
    search: window.location.search,
    cookie: document.cookie,
    ga: process.env.NEXT_PUBLIC_EASY_CONNECT_GA === 'true',
  })
}

export function writePreviewCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${PREVIEW_COOKIE}=1; path=/; max-age=${PREVIEW_MAX_AGE_SEC}; SameSite=Lax`
}

export function clearPreviewCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${PREVIEW_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}
