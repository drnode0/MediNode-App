// テーマ（外観）の管理ユーティリティ。
// darkMode: 'class' 前提で、<html> の .dark を付け外しして実効テーマを切り替える。
//
// 設計:
// - 端末ごとの設定（localStorage）。サーバー同期しない。
//   理由: 「スマホはダーク・iPadはライト」が自然／描画前に確定させる必要があり、
//   非同期のサーバー設定だと初回にちらつく（FOUC）。
// - 3値: 'system'（OS追従＝従来挙動）/ 'light' / 'dark'。既定は 'system'。
// - 実際の付け外しは <head> のインライン初期化スクリプトが最初に行い（ちらつき防止）、
//   起動後の追従・切替はここと ThemeSync が担う（冪等）。

export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'medinode-theme'
// テーマ変更を同一タブ内のリスナー（ThemeSync 等）へ伝えるカスタムイベント。
export const THEME_CHANGE_EVENT = 'medinode-theme-change'

// ステータスバー等（theme-color メタ）に反映する実効色。tailwind の brand-600 / スプラッシュ暗色に合わせる。
export const THEME_COLORS = { light: '#196b4f', dark: '#10151c' } as const

export function getThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* localStorage 不可（プライベートモード等）は system 既定へ */
  }
  return 'system'
}

export function prefersDark(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

// 設定値から「今ダークにすべきか」を解決する。
export function resolveDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'system' && prefersDark())
}

// 実効テーマを <html>.dark と theme-color メタへ反映する（描画に関わるため React 外からも呼べる）。
export function applyTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return
  const dark = resolveDark(pref)
  document.documentElement.classList.toggle('dark', dark)
  try {
    const color = dark ? THEME_COLORS.dark : THEME_COLORS.light
    // media 付き/無しの theme-color メタをすべて実効色で上書きし、手動選択でも確実に反映する。
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', color))
  } catch {
    /* メタ更新はベストエフォート（ステータスバー色のみ） */
  }
}

// 設定値を保存し、即時反映＋同一タブへ通知する。
export function setThemePref(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* 保存不可でも見た目だけは切り替える */
  }
  applyTheme(pref)
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: pref }))
  } catch {
    /* 環境非対応でも致命ではない */
  }
}
