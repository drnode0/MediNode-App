'use client'
// リーダー末尾「つづけて読む」枠。(a)根拠文献（参考文献リレーション実登録分）、
// (b)関連ナレッジ（ジャンル＋キーワードの自動算出・上位3件）。手動キュレーションなし。
// データはAlgolia（会員のSecured Key）から取得。失敗時は静かに何も出さない。
import { useEffect, useState } from 'react'
import { NotebookText, Bookmark, ArrowRight } from 'lucide-react'
import { createSubscriptionSearchClient, getSubscriptionIndexName } from '@/lib/algolia'
import { pickRelated, type RelatedSource } from '@/lib/related-knowledge'
import { stripLeadingEmoji } from '@/lib/labels'
import { useReader } from './SubscriptionReader'

type FooterData = { references: RelatedSource[]; related: RelatedSource[] }

async function loadFooterData(objectID: string): Promise<FooterData> {
  const index = createSubscriptionSearchClient().initIndex(getSubscriptionIndexName())
  const current = await index.getObject<RelatedSource & { referenceIds?: string[] }>(objectID)
  // 根拠文献: リレーション実登録分のみ。存在しないIDはnullで返るので落とす。
  const refIds = (current.referenceIds || []).map((id) => `subscription_${id}`)
  const refsPromise = refIds.length
    ? index.getObjects<RelatedSource>(refIds).then((r) => r.results.filter(Boolean) as RelatedSource[])
    : Promise.resolve([] as RelatedSource[])
  // 関連ナレッジ候補: 同ジャンルのナレッジ（distinctで親が代表になる）
  const genreFilters = (current.genre || []).map((g) => `genre:${g}`)
  const relatedPromise = genreFilters.length
    ? index
        .search<RelatedSource>('', { facetFilters: [genreFilters], filters: 'source:medical', hitsPerPage: 30 })
        .then((r) => pickRelated(current, r.hits))
    : Promise.resolve([] as RelatedSource[])
  const [references, related] = await Promise.all([refsPromise, relatedPromise])
  return { references, related }
}

export function ReaderFooter({ objectID }: { objectID: string }) {
  const { open } = useReader()
  const [data, setData] = useState<FooterData | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    loadFooterData(objectID)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData({ references: [], related: [] }) })
    return () => { alive = false }
  }, [objectID])

  if (!data || (data.references.length === 0 && data.related.length === 0)) return null

  const openItem = (item: RelatedSource) => {
    open({
      objectID: item.objectID,
      title: item.title,
      notionUrl: item.notionUrl || '',
      knowledgeLevel: item.knowledgeLevel,
      owner: 'subscription',
      source: item.source,
      recordingLevel: item.recordingLevel,
      summary: item.aiSummary,
    })
  }

  return (
    <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">つづけて読む</p>
      {data.references.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">根拠文献</p>
          <ul className="space-y-1">
            {data.references.map((r) => {
              const deep = (r.recordingLevel || '').includes('精読')
              const Icon = deep ? NotebookText : Bookmark
              return (
                <li key={r.objectID}>
                  <button
                    type="button"
                    onClick={() => openItem(r)}
                    className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-300"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${deep ? 'text-amber-600 dark:text-amber-400' : 'text-amber-400 dark:text-amber-500'}`} aria-hidden />
                    <span className="min-w-0 truncate">{stripLeadingEmoji(r.title)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {data.related.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">関連ナレッジ</p>
          <ul className="space-y-1">
            {data.related.map((r) => (
              <li key={r.objectID}>
                <button
                  type="button"
                  onClick={() => openItem(r)}
                  className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-300"
                >
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
                  <span className="min-w-0 truncate">{stripLeadingEmoji(r.title)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
