'use client'
import { ChevronDown, ChevronUp, BookMarked } from 'lucide-react'
import { Highlight } from 'react-instantsearch'
import { useState } from 'react'

export type Hit = {
  objectID: string
  title: string
  source: 'medical' | 'reference' | 'manual'
  owner?: 'personal' | 'team' | 'subscription'
  // マニュアルDB用：種別（📕マニュアル/📢お知らせ/🔧業務改善）・掲載日(YYYY-MM-DD)
  manualType?: string
  publishedAt?: string
  teamLabel?: string
  genre?: string | string[]
  genreList?: string[]
  detailGenre?: string
  knowledgeLevel?: string
  type?: string
  tags?: string
  status?: string
  summary?: string
  aiSummary?: string
  evidenceLevel?: string
  author?: string
  journal?: string
  year?: string
  relatedCQTitles?: string[]
  relatedRefTitles?: string[]
  aiKeywords?: string
  hasAttachment?: boolean
  notionUrl: string
  lastEdited: string
  createdAt?: string
}

const LEVEL_STYLE: Record<string, string> = {
  '❓ クリニカルクエスチョン': 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  '💡 ナレッジ': 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  '📋 まとめ': 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
}

const OWNER_BADGE: Record<string, { label: string; style: string }> = {
  personal: { label: '個人', style: 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300' },
  team: { label: '部署', style: 'bg-teal-50 text-teal-700' },
  subscription: { label: 'プレミアム', style: 'bg-purple-50 text-purple-700' },
}

export function ResultCard({ hit }: { hit: Hit }) {
  const [expanded, setExpanded] = useState(false)
  const isMedical = hit.source === 'medical'
  const sourceLabel = isMedical ? 'Medical' : 'Ref'
  const sourceBg = isMedical ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
  const borderColor = isMedical ? 'border-l-brand-400' : 'border-l-amber-400'
  const levelStyle = hit.knowledgeLevel ? (LEVEL_STYLE[hit.knowledgeLevel] || 'bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300') : ''
  const displaySummary = hit.aiSummary || hit.summary || null
  const hasExpandable = !!displaySummary
  const ownerBadge = hit.owner && hit.owner !== 'personal' ? OWNER_BADGE[hit.owner] : null
  const ownerLabel = ownerBadge
    ? (hit.owner === 'team' && hit.teamLabel ? hit.teamLabel : ownerBadge.label)
    : null

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${borderColor} overflow-hidden`}>
      {/* メイン部分：タップで展開（要約ありの場合のみ） */}
      <div
        className={`p-4 ${hasExpandable ? 'cursor-pointer' : ''}`}
        onClick={() => hasExpandable && setExpanded((v) => !v)}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base leading-snug flex-1">
            {(hit as any)._highlightResult
              ? <Highlight attribute="title" hit={hit as any} />
              : hit.title}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {ownerLabel && ownerBadge && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${ownerBadge.style}`}>
                {ownerLabel}
              </span>
            )}
            {hit.hasAttachment && (
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" title="ファイル添付あり">
                📎
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${sourceBg}`}>
              {sourceLabel}
            </span>
            {hasExpandable && (
              <span className="text-gray-300 text-xs">{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {hit.knowledgeLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${levelStyle}`}>
              {hit.knowledgeLevel}
            </span>
          )}
          {!isMedical && hit.evidenceLevel && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              {hit.evidenceLevel}
            </span>
          )}
          {(Array.isArray(hit.genre) ? hit.genre : hit.genre ? [hit.genre] : []).map((g) => (
            <span key={g} className="text-xs bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 px-2 py-0.5 rounded-full">
              {g}
            </span>
          ))}
          {hit.detailGenre && (
            <span className="text-xs bg-brand-50 dark:bg-brand-900/40 text-brand-500 dark:text-brand-300 px-2 py-0.5 rounded-full">
              {hit.detailGenre}
            </span>
          )}
        </div>

        {/* 折りたたみ時：2行まで表示 */}
        {!expanded && (
          displaySummary ? (
            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{displaySummary}</p>
          ) : (
            <p className="text-xs text-gray-300 italic">要約なし</p>
          )
        )}

        <div className="flex items-center justify-between mt-1.5 gap-2">
          <p className="text-xs text-gray-400 truncate">
            {hit.author || ''}{hit.journal ? (hit.author ? ` · ${hit.journal}` : hit.journal) : ''}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isMedical && hit.year && (
              <span className="text-xs font-semibold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded-full">
                {hit.year}
              </span>
            )}
            {hit.createdAt && (
              <p className="text-xs text-gray-300">
                {new Date(hit.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {!isMedical && hit.relatedCQTitles && hit.relatedCQTitles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hit.relatedCQTitles.map((cq, i) => (
              <span key={i} className="text-xs bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-200 leading-snug">
                ❓ {cq}
              </span>
            ))}
          </div>
        )}

        {isMedical && hit.relatedRefTitles && hit.relatedRefTitles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hit.relatedRefTitles.map((ref, i) => (
              <span key={i} className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full border border-amber-200 leading-snug">
                <BookMarked className="w-3 h-3 inline -mt-0.5 mr-1" />{ref}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 展開時：全文＋Notionリンク */}
      {expanded && displaySummary && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pt-3 whitespace-pre-wrap">
            {displaySummary}
          </p>
          {hit.aiKeywords && (
            <p className="text-xs text-gray-300 mt-3 leading-relaxed">
              {hit.aiKeywords}
            </p>
          )}
          <div className="flex justify-end mt-3">
            <a
              href={hit.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
            >
              Notionで開く
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* 要約なし：カード全体がNotionリンク */}
      {!hasExpandable && (
        <a
          href={hit.notionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-4 pb-3 text-xs text-brand-500 dark:text-brand-300 hover:text-brand-700 dark:text-brand-300"
        >
          Notionで開く →
        </a>
      )}
    </div>
  )
}
