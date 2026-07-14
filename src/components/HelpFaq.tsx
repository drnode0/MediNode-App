'use client'

// アプリ内FAQ検索（設定 → ヘルプの最上部）。
// ガイドの要点を同梱した help-faq.ts をキーワード検索・カテゴリ絞り込みできる。
// 「Notionの長いガイドから探す」手間を、アプリ内で完結させるためのUI。

import { useMemo, useState } from 'react'
import { Search, ChevronDown, ExternalLink } from 'lucide-react'
import {
  FAQ_ENTRIES,
  FAQ_CATEGORIES,
  searchFaq,
  type FaqCategory,
} from '@/lib/help-faq'

const GUIDE_URL = 'https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc'

export function HelpFaq() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FaqCategory | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const results = useMemo(() => searchFaq(FAQ_ENTRIES, query, category), [query, category])

  return (
    <section>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpenId(null)
          }}
          placeholder="使い方・エラーをキーワードで検索（例: 同期 / 403 / パスワード）"
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1">
        {([null, ...FAQ_CATEGORIES] as (FaqCategory | null)[]).map((c) => (
          <button
            key={c ?? 'all'}
            onClick={() => {
              setCategory(c)
              setOpenId(null)
            }}
            className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors ${
              category === c
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {c ?? 'すべて'}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center leading-relaxed">
          見つかりませんでした。言い換えて検索するか、
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline underline-offset-2 mx-0.5">ガイド全文</a>
          をご覧ください。
        </div>
      ) : (
        <div className="rounded-xl ring-1 ring-gray-100 dark:ring-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
          {results.map((e) => {
            const open = openId === e.id
            return (
              <div key={e.id} className="bg-white dark:bg-gray-800">
                <button
                  onClick={() => setOpenId(open ? null : e.id)}
                  aria-expanded={open}
                  className="w-full flex items-start gap-2 px-3.5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">{e.q}</span>
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{e.category}</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 text-gray-300 dark:text-gray-600 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <p className="px-3.5 pb-3.5 text-xs text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                    {e.a}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <a
        href={GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center justify-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 py-1"
      >
        解決しないときはガイド全文へ
        <ExternalLink className="w-3 h-3" />
      </a>
    </section>
  )
}
