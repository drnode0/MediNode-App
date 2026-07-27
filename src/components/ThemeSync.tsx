'use client'

// テーマの起動時反映＋OS追従を担う常駐コンポーネント（描画なし）。
// - 起動直後に保存値で実効テーマを再適用（<head> のインラインscriptと二重でも冪等）。
// - 「システム」選択時は、アプリを開いたままOSのライト/ダークが変わっても追従する。
// - 設定パネルでの切替（THEME_CHANGE_EVENT）にも反応し、複数箇所の表示を揃える。

import { useEffect } from 'react'
import { applyTheme, getThemePref, THEME_CHANGE_EVENT } from '@/lib/theme'

export function ThemeSync() {
  useEffect(() => {
    applyTheme(getThemePref())

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onOsChange = () => {
      // system のときだけOS変更に追従する（明示的にライト/ダークを選んでいれば無視）。
      if (getThemePref() === 'system') applyTheme('system')
    }
    const onPrefChange = () => applyTheme(getThemePref())

    mq.addEventListener('change', onOsChange)
    window.addEventListener(THEME_CHANGE_EVENT, onPrefChange)
    return () => {
      mq.removeEventListener('change', onOsChange)
      window.removeEventListener(THEME_CHANGE_EVENT, onPrefChange)
    }
  }, [])

  return null
}
