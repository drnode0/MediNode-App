// 直近のクライアントエラーの控え（フィードバックのバグ報告に添えるためだけの用途）。
//
// バグ報告でいちばん効くのは「そのとき何が壊れたか」だが、利用者はそれを書けない。
// そこで画面側のエラーを少数だけ手元に残し、送信時に添える。
//
// 方針:
// - メモリ上のリングバッファのみ。永続化しない（端末に医療情報の痕跡を残さない）。
// - 残すのは「メッセージ＋パス」だけ。パスはクエリ・ハッシュを落とす
//   （検索語＝利用者の医療クエリを外へ出さないため。redactPath が関門）。
// - 上限件数で打ち切り、同一メッセージの連続は畳む（連打で埋まらないように）。
// - 送信しない限りどこにも出ない。ここは「控え」であって送信機構ではない。

import { redactPath } from './feedback-submit'

export const CLIENT_ERROR_MAX = 5
const MESSAGE_MAX = 180

// 新しいものが先頭。
let buffer: string[] = []

export function recordClientError(message: string, path?: string): void {
  const msg = String(message ?? '').trim().slice(0, MESSAGE_MAX)
  if (!msg) return

  const where = redactPath(path ?? '')
  const entry = where ? `${msg} @ ${where}` : msg

  // 同一エラーの連続は1件に畳む（同じ操作を繰り返しても控えが埋まらない）。
  if (buffer[0] === entry) return

  buffer.unshift(entry)
  if (buffer.length > CLIENT_ERROR_MAX) buffer.length = CLIENT_ERROR_MAX
}

export function recentClientErrors(): string[] {
  return [...buffer]
}

export function clearClientErrors(): void {
  buffer = []
}

// window のエラーを控えに流す。アプリ起動時に1回だけ呼ぶ。
// 解除関数を返す（テスト・アンマウント用）。
export function installClientErrorCapture(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (e: ErrorEvent) => {
    recordClientError(e.message, window.location?.pathname)
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: unknown } | undefined
    recordClientError(String(r?.message ?? r ?? 'unhandled rejection'), window.location?.pathname)
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
