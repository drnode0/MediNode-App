// Notion OAuthの redirect_uri を組み立てる唯一の場所。
//
// なぜ要るか: 認可URL（/connect/notion, サーバーコンポーネント）とコード交換
// （/api/notion/oauth/callback, ルートハンドラ）は redirect_uri を別々に組み立てていたが、
// Notionは認可時と交換時でこの値が1文字でも違うと交換を拒む。かつ実行文脈が違う
// （片方は headers() のホスト値、片方は req.url）ので、組み立てロジックそのものを
// ここへ集約し、両方が必ず同じ結果になるようにする。
//
// 純粋関数のみ。next/headers も Request も扱わない — 呼び出し側が文字列で渡す。

export const NOTION_OAUTH_CALLBACK_PATH = '/api/notion/oauth/callback'

// Host ヘッダーの値からポート部分を取り除く。IPv6は `[::1]:3000` のように
// 角括弧で囲まれてくるので、括弧の中身だけを取り出す。
function hostnameOnly(host: string): string {
  const trimmed = host.trim()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(1, end)
  }
  const colonIdx = trimmed.lastIndexOf(':')
  if (colonIdx === -1) return trimmed
  const maybePort = trimmed.slice(colonIdx + 1)
  return /^\d+$/.test(maybePort) ? trimmed.slice(0, colonIdx) : trimmed
}

// localhost・ループバック・プライベートIPv4レンジ（10./192.168./172.16.〜172.31.）を
// 「ローカルまたは社内LAN」とみなす。実機（同一Wi-Fi上のiPhone等）からの検証で
// x-forwarded-proto が付かないケースをここで http と判定するための分類。
function isLocalOrPrivateHost(host: string): boolean {
  const name = hostnameOnly(host).toLowerCase()
  if (name === 'localhost' || name === '127.0.0.1' || name === '::1') return true

  const m = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function guessProtocol(host: string, forwardedProto?: string | null): string {
  if (forwardedProto) return forwardedProto
  return isLocalOrPrivateHost(host) ? 'http' : 'https'
}

// callback ルートハンドラ用：req.url（フルURL文字列）からcallbackパスのURLを組み立てる。
export function redirectUriFromRequestUrl(requestUrl: string): string {
  return new URL(NOTION_OAUTH_CALLBACK_PATH, requestUrl).toString()
}

// /connect/notion（サーバーコンポーネント）用：headers() から読んだ host / x-forwarded-proto
// の文字列からURLを組み立てる。new URL() を通すことで、大文字小文字・既定ポートの
// 正規化が redirectUriFromRequestUrl と完全に同一になる。
export function redirectUriFromHost(opts: { host: string; forwardedProto?: string | null }): string {
  const proto = guessProtocol(opts.host, opts.forwardedProto)
  return new URL(`${proto}://${opts.host}${NOTION_OAUTH_CALLBACK_PATH}`).toString()
}
