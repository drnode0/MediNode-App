'use client'
import { useEffect } from 'react'
import { prefetchReaderDoc } from './reader-prefetch'
import { isInAppReaderTarget } from './subscription-open'
import { pickPrefetchTargets, schedulePrefetch, type PrefetchCandidate } from './reader-prefetch-plan'

// 検索結果の上位だけを、触られる前に先読みしておくフック。
// 選定規則（owner ごとの上限・節レコードの親解決）と待ち時間は reader-prefetch-plan.ts。
// 重複排除と10分キャッシュは prefetchReaderDoc 側が持っているので、ここでは何も持たない。
export function usePrefetchTopHits(hits: readonly PrefetchCandidate[]): void {
  // hits は毎レンダー新しい配列参照になるため、依存には確定したID列（文字列）を使う。
  const ids = pickPrefetchTargets(hits, isInAppReaderTarget).join(',')
  useEffect(
    () => schedulePrefetch(ids ? ids.split(',') : [], prefetchReaderDoc),
    [ids],
  )
}
