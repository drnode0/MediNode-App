// かんたん接続の観測（設計書§14）。**サーバー専用**（`@vercel/analytics/server` を
// 読むので、クライアントコンポーネントから import しない。クライアント側の
// `easy_connect_handoff_copied` 等は `@vercel/analytics` の track を直接使う）。
//
// なぜサーバーに置くか: callback は失敗の理由をURLに出さない設計になっている
// （理由を出すと、他人のstateを踏ませた相手に「そのstateがどう無効か」を教える
// オラクルになる）。そのため**種別が残るのはここだけ**で、これが無いと
// 「認可したのに戻れなかった」が全部ひとかたまりの沈黙になる。
//
// 判定に使う数字（§14）: start→claimed の完遂率、callback_error の内訳、
// db_unreadable の発生数。
//
// カスタムイベントは Vercel の有料プラン機能。無料プランでは送っても
// ダッシュボードに出ないだけで、エラーにはならない（AnalyticsEvents.tsx と同じ前提）。
import { track } from '@vercel/analytics/server'

export type EasyConnectServerEvent =
  | 'easy_connect_start'
  | 'easy_connect_callback_ok'
  | 'easy_connect_callback_error'
  | 'easy_connect_claimed'
  | 'easy_connect_db_unreadable'

// 入口の出どころ。どこから乗り換えが起きているかを見るためだけに使う。
export const EASY_CONNECT_ENTRIES = ['setup', 'settings', 'settings_repick', 'reauth'] as const
export type EasyConnectEntry = (typeof EASY_CONNECT_ENTRIES)[number]

export function normalizeEntry(raw: string | null | undefined): EasyConnectEntry | 'unknown' {
  return (EASY_CONNECT_ENTRIES as readonly string[]).includes(raw || '')
    ? (raw as EasyConnectEntry)
    : 'unknown'
}

export function trackEasyConnect(
  event: EasyConnectServerEvent,
  props?: Record<string, string | number | boolean>,
): void {
  // 観測が本筋を止めてはいけない。await せず、例外も飲む
  // （Vercel外＝ローカル・テストでは track が使えないことがある）。
  try {
    void Promise.resolve(track(event, props)).catch(() => {})
  } catch {
    // 記録できないだけ。接続の成否には影響させない。
  }
}
