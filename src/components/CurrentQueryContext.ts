import { createContext } from 'react'

// いま検索ボックスに入っているクエリ。ResultCardが「本文ヒット→リーダーに検索語を引き継ぐ」
// ために読む。InstantSearchコンテキスト外でも安全に使えるよう素のReact contextにする。
export const CurrentQueryCtx = createContext<string>('')
