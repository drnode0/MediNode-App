// Notion認可へ出る前に「戻ってくるはずの続きがある」ことを端末に残す。
//
// 2026-08-08のdemo検証で、認可から戻ったときにログインが切れていると、何の説明も
// なくセットアップ入口に落ちることが分かった。そこで別のアドレスを打って新規
// アカウントを作ってしまうと、接続の引き取り（claim）は元のアカウント宛のため
// 永久に何も繋がらない。このフラグがあれば、入口で「さっきのアドレスでログイン
// すれば続きが始まる」と案内できる。
//
// 保存するのはメールアドレスのヒントと時刻だけ（トークン等は含まない）。

export const EC_RETURN_KEY = 'medinode_ec_return'

// 引き取り（claim）の猶予に合わせて1時間で無効化する。古いフラグで案内すると、
// もう引き取れないのに「ログインすれば始まる」と嘘をつくことになる。
export const EC_RETURN_FRESH_MS = 60 * 60 * 1000

export function isEcReturnFresh(atMs: number, nowMs: number): boolean {
  return nowMs - atMs >= 0 && nowMs - atMs < EC_RETURN_FRESH_MS
}

export function markEcReturnPending(email: string): void {
  try {
    localStorage.setItem(EC_RETURN_KEY, JSON.stringify({ email, at: Date.now() }))
  } catch {
    // 保存できないだけ。接続自体には影響させない。
  }
}

export function readEcReturnPending(): { email: string; at: number } | null {
  try {
    const raw = localStorage.getItem(EC_RETURN_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown }
    if (typeof v.at !== 'number' || !isEcReturnFresh(v.at, Date.now())) return null
    return { email: typeof v.email === 'string' ? v.email : '', at: v.at }
  } catch {
    return null
  }
}

export function clearEcReturnPending(): void {
  try {
    localStorage.removeItem(EC_RETURN_KEY)
  } catch {
    // 消せないだけ。1時間で自然に無効になる。
  }
}
