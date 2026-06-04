'use client'
import { useHits, Configure } from 'react-instantsearch'
import { useState } from 'react'
import { ResultCard, type Hit } from './ResultCard'

// ジャンルを系統別グループに分類
const GENRE_GROUPS = [
  {
    label: '🫀 循環・血液',
    color: 'bg-red-50 border-red-200 text-red-700',
    activeColor: 'bg-red-600 text-white',
    genres: ['05.循環', '11.血液凝固線溶系', '22.輸液・輸血・水電解質'],
  },
  {
    label: '🫁 呼吸器',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    activeColor: 'bg-blue-600 text-white',
    genres: ['04.呼吸'],
  },
  {
    label: '🧠 神経・精神',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
    activeColor: 'bg-purple-600 text-white',
    genres: ['06.中枢神経'],
  },
  {
    label: '🫘 腎・泌尿器',
    color: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    activeColor: 'bg-cyan-600 text-white',
    genres: ['07.腎'],
  },
  {
    label: '🫃 消化器',
    color: 'bg-orange-50 border-orange-200 text-orange-700',
    activeColor: 'bg-orange-600 text-white',
    genres: ['08.肝・胆道系', '09.膵', '10.消化管・その他腹部'],
  },
  {
    label: '🦠 感染症',
    color: 'bg-green-50 border-green-200 text-green-700',
    activeColor: 'bg-green-600 text-white',
    genres: ['13.感染症'],
  },
  {
    label: '⚡ 救急・外傷',
    color: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    activeColor: 'bg-yellow-600 text-white',
    genres: ['03.救急蘇生', '15.外傷・整形', '16.熱傷', '17.急性中毒', '18.体温異常', '28.災害'],
  },
  {
    label: '💊 薬剤・代謝',
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    activeColor: 'bg-indigo-600 text-white',
    genres: ['12.代謝内分泌', '27.薬剤', '14.多臓器障害'],
  },
  {
    label: '🍼 特殊患者',
    color: 'bg-pink-50 border-pink-200 text-pink-700',
    activeColor: 'bg-pink-600 text-white',
    genres: ['19.妊産婦', '20.小児', '21.移植'],
  },
  {
    label: '🔧 手技・栄養',
    color: 'bg-gray-50 border-gray-200 text-gray-700',
    activeColor: 'bg-gray-600 text-white',
    genres: ['23.栄養', '24.画像診断', '26.手技'],
  },
  {
    label: '📚 総論・その他',
    color: 'bg-slate-50 border-slate-200 text-slate-700',
    activeColor: 'bg-slate-600 text-white',
    genres: ['01.総論', '02.医療倫理', '25.集中治療医', '29.学会', '30.統計・研究', '31.マイナー'],
  },
  {
    label: '📥 INBOX',
    color: 'bg-gray-50 border-gray-200 text-gray-500',
    activeColor: 'bg-gray-500 text-white',
    genres: ['INBOX'],
  },
]

function GenreGroupFilter({ onGroupSelect, selectedGroup }: {
  onGroupSelect: (genres: string[] | null) => void
  selectedGroup: string | null
}) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      {GENRE_GROUPS.map((group) => (
        <button
          key={group.label}
          onClick={() => {
            if (selectedGroup === group.label) {
              onGroupSelect(null)
            } else {
              onGroupSelect(group.genres)
            }
          }}
          className={`text-left px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
            selectedGroup === group.label
              ? group.activeColor + ' border-transparent shadow-sm'
              : group.color + ' hover:shadow-sm'
          }`}
        >
          {group.label}
        </button>
      ))}
    </div>
  )
}

function FilteredHits() {
  const { hits } = useHits()
  if (hits.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p>このジャンルにはまだエントリがありません</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {hits.map((hit) => (
        <ResultCard key={hit.objectID} hit={hit as unknown as Hit} />
      ))}
    </div>
  )
}

export function GenreBrowse() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [filterGenres, setFilterGenres] = useState<string[] | null>(null)

  const handleGroupSelect = (genres: string[] | null) => {
    const group = genres ? GENRE_GROUPS.find((g) => g.genres === genres)?.label ?? null : null
    setSelectedGroup(group)
    setFilterGenres(genres)
  }

  // Algoliaのfilters文字列を構築
  const filtersStr = filterGenres
    ? filterGenres.map((g) => `genre:"${g}"`).join(' OR ')
    : ''

  return (
    <div>
      <GenreGroupFilter onGroupSelect={handleGroupSelect} selectedGroup={selectedGroup} />
      {selectedGroup && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700">{selectedGroup}</p>
          <button
            onClick={() => handleGroupSelect(null)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ✕ 解除
          </button>
        </div>
      )}
      <Configure filters={filtersStr} hitsPerPage={50} />
      {selectedGroup ? (
        <FilteredHits />
      ) : (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">カテゴリを選択してください</p>
        </div>
      )}
    </div>
  )
}
