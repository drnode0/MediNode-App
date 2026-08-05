// かんたん接続の state まわりの純関数。DB・Notion・next/headers に依存しない。
// 時刻は必ず引数で受け取る（テストで境界をそのまま書けるようにするため）。
import { randomBytes } from 'crypto'

// 認可へ出てから戻ってくるまでの猶予。これを過ぎた state では交換しない。
//
// 30分にしてあるのは、最頻経路がPCハンドオフだから（§22②）。この時間で実際にやるのは
// 「リンクをコピー → PCを開く → ブラウザ起動 → Notionにログイン → ページを選ぶ」で、
// 10分では足りずに「この接続リンクは使えません」だけが出ていた。stateは192ビット・
// 一回限り・一方向なので、TTLはここでの主防御ではない。
export const PENDING_TTL_MS = 30 * 60_000

// 認可が完了してから、本人のアプリが引き取るまでの猶予。
// スマホで始めてPCで認可を終え、スマホに戻るまでを想定して pending より長く取る。
export const CLAIM_WINDOW_MS = 60 * 60_000

// state は唯一の鍵（callbackはCookieもセッションも見ない）。推測不能な長さにする。
export function generateState(): string {
  return randomBytes(24).toString('hex')
}

function elapsedMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return nowMs - t
}

export function isPendingExpired(createdAt: string, nowMs: number): boolean {
  const elapsed = elapsedMs(createdAt, nowMs)
  // 日時が読めない行は壊れているとみなし、使わせない。
  if (elapsed === null) return true
  return elapsed > PENDING_TTL_MS
}

export function isClaimExpired(completedAt: string | null, nowMs: number): boolean {
  const elapsed = elapsedMs(completedAt, nowMs)
  if (elapsed === null) return true
  return elapsed > CLAIM_WINDOW_MS
}

// 完了ページに「どのアカウントへ保存するか」を出すための表示用。
// 心当たりの無いメールなら進まないでもらうのが目的なので、ドメインは残す。
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '（不明なアカウント）'
  const at = email.indexOf('@')
  if (at <= 0) return '（不明なアカウント）'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local.slice(0, 2)}***${domain}`
}
