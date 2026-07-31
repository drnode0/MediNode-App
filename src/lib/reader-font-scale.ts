// リーダー本文の文字サイズ設定（Aaボタン）。
// テーマ（theme.ts）と同じ「端末ごとの設定」— localStorage・サーバー同期しない。
// 個人を推測させる情報ではないため PERSONAL_DEVICE_KEYS には含めない。
//
// スケールは em で本文ラッパーに掛ける（ReaderBody 内の見出し・表も em 系サイズなので
// 一緒に拡大される）。iOS の Dynamic Type（.ios-dt .reader-prose）とは乗算で合成される。

export type ReaderFontScale = 'std' | 'lg' | 'xl'

export const READER_FONT_SCALE_KEY = 'medinode-reader-font-scale'

export const SCALE_EM: Record<ReaderFontScale, string> = {
  std: '1em',
  lg: '1.125em',
  xl: '1.25em',
}

export const SCALE_LABEL: Record<ReaderFontScale, string> = {
  std: '標準',
  lg: '大',
  xl: '特大',
}

// Aaボタンの巡回順。特大の次は標準へ戻る。
export function nextScale(s: ReaderFontScale): ReaderFontScale {
  return s === 'std' ? 'lg' : s === 'lg' ? 'xl' : 'std'
}

export function getReaderFontScale(): ReaderFontScale {
  if (typeof window === 'undefined') return 'std'
  try {
    const v = window.localStorage.getItem(READER_FONT_SCALE_KEY)
    if (v === 'std' || v === 'lg' || v === 'xl') return v
  } catch {
    /* localStorage 不可（プライベートモード等）は標準へ */
  }
  return 'std'
}

export function setReaderFontScale(s: ReaderFontScale): void {
  try {
    window.localStorage.setItem(READER_FONT_SCALE_KEY, s)
  } catch {
    /* 保存できない環境ではセッション内のみ有効 */
  }
}

// iOS / iPadOS 判定（Dynamic Type 追従のゲート）。
// macOS Safari にも -apple-system-body が効いて逆に縮む事故があるため、
// タッチ搭載の Apple 端末に限って有効化する（iPadOS は MacIntel + タッチで名乗る）。
export function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
