import { createContext } from 'react'

// 個人・部署リーダー（降格式）の「元ページ」情報。
// doc.sourceUrl があるとき（＝個人・部署ページのみ）ReaderBody が provide し、
// 未対応ブロックのプレースホルダがNotionのブロックアンカーへのリンクを組むのに使う。
// サブスク配信では常に null（本文防衛のためNotion URLを本文側に出さない）。
export type ReaderSource = { url: string; owner?: string }
export const ReaderSourceCtx = createContext<ReaderSource | null>(null)
