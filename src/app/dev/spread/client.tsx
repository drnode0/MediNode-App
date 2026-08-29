'use client'
// /dev/spread のクライアント側。実物の ReaderSpread ＋ ReaderNavBar（目次・読了バー・凡例）を、
// リーダーの面（bg-white / dark:bg-gray-800・max-w-2xl・スクロール容器）に載せて目視する。
// ダーク切替と記事内検索（検索中の全節展開の確認用）だけ持つ。
import { useRef, useState } from 'react'
import { ReaderSpread } from '@/components/reader/spread/ReaderSpread'
import { ReaderNavBar } from '@/components/reader/ReaderNavBar'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'
import type { ReaderDoc } from '@/lib/reader-doc'
import type { SpreadDoc } from '@/lib/reader-spread'
import type { Confidence } from '@/lib/reader-confidence'

export type DevSpreadPayload = {
  spread: SpreadDoc
  doc: ReaderDoc
  lastEdited: string | null
  cover: string | null
  title: string
  icon: string | null
}

const NO_FILTER: Set<Confidence> = new Set()

export function DevSpreadClient({ payload }: { payload: DevSpreadPayload }) {
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-800">
      {/* data-harness-bar: 静止スナップショット（.preview/build-snapshot.mts）が
          このツールバーだけを隠すための目印。 */}
      <div data-harness-bar className="shrink-0 flex items-center gap-2 px-5 py-3 border-b border-gray-200 dark:border-gray-700">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="記事内検索（検索中は全節が開く）"
          className="flex-1 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-900 dark:text-gray-100"
        />
        {/* ダークは darkMode:'class' 運用。prefers-color-scheme だけでは変わらないので手で付け外しする。 */}
        <button
          type="button"
          onClick={() => document.documentElement.classList.toggle('dark')}
          className="rounded-full border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-200"
        >
          ダーク切替
        </button>
      </div>
      {/* ReaderOverlay と同じく、スクロールはこの容器が持つ（ReaderNavBar の sticky・読了バーの前提）。 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4 pb-20 scroll-pt-14">
        <div className="mx-auto w-full max-w-2xl">
          {/* スプレッドは自前の追従目次を持つため ReaderNavBar は出さない（ReaderOverlay と同じ扱い）。 */}
          <ReaderSearchCtx.Provider value={query}>
            <ReaderSpread
              spread={payload.spread}
              onImageClick={() => {}}
              lastEdited={payload.lastEdited}
              cover={payload.cover}
              title={payload.title}
              icon={payload.icon}
              genre={payload.doc.genre}
              questionType={payload.doc.questionType}
              scrollRef={scrollRef}
            />
          </ReaderSearchCtx.Provider>
        </div>
      </div>
    </div>
  )
}
