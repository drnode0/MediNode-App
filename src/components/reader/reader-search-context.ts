import { createContext } from 'react'

// リーダー内検索の現在クエリ。空文字なら非検索（ハイライトなし）。
// Provider は ReaderOverlay、Consumer は ReaderBody の Inlines。
export const ReaderSearchCtx = createContext<string>('')
