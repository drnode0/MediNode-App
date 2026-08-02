'use client'

// 列名マッピングのドロップダウンUI。手入力（タイプミスの温床）を排し、
// 実際にDBにある列名からだけ選ばせる。選択肢は役割ごとに型で絞る。
// 空文字 = 既定名（要約/キーワード/ジャンル/知識レベル）をそのまま読む。

import { inferPropMap, typeAllowedColumns, type NotionPropSchema } from '@/lib/prop-infer'

export type PropMapValue = {
  propSummary: string
  propKeywords: string
  propKnowledgeLevel: string
  propGenre: string
}

const ROWS: Array<{
  key: keyof PropMapValue
  role: 'summary' | 'keywords' | 'genre' | 'knowledgeLevel'
  label: string
  defaultName: string
}> = [
  { key: 'propSummary', role: 'summary', label: '要約', defaultName: '要約' },
  { key: 'propKeywords', role: 'keywords', label: 'キーワード', defaultName: 'キーワード' },
  { key: 'propGenre', role: 'genre', label: 'ジャンル', defaultName: 'ジャンル' },
  { key: 'propKnowledgeLevel', role: 'knowledgeLevel', label: '知識レベル', defaultName: '知識レベル' },
]

export function PropMapEditor({
  schema,
  value,
  onChange,
}: {
  schema: NotionPropSchema[]
  value: PropMapValue
  onChange: (patch: Partial<PropMapValue>) => void
}) {
  const inference = inferPropMap(schema)
  return (
    <div className="space-y-2.5">
      {ROWS.map((row) => {
        const inf = inference[row.role]
        // 選択肢: 型が合う全列（claimなし）。推定bestを先頭に、保存済みのリスト外値は最前へ
        const allowed = typeAllowedColumns(schema, row.role)
        const options = inf.best
          ? [inf.best, ...allowed.filter((n) => n !== inf.best)]
          : [...allowed]
        if (value[row.key] && !options.includes(value[row.key])) options.unshift(value[row.key])
        return (
          <div key={row.key} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300">{row.label}</span>
            <span className="text-gray-400 dark:text-gray-500 text-xs">←</span>
            <select
              value={value[row.key]}
              onChange={(e) => onChange({ [row.key]: e.target.value })}
              className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              <option value="">既定（「{row.defaultName}」を読む）</option>
              {options.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}
