'use client'

// タブ共通の所有者フィルタ（全て/個人/部署/プレミアム）。page.tsx から分割。

import { useContext } from 'react'
import { getSettings } from '@/lib/settings'
import { OpenSettingsContext } from './SearchErrors'

export type OwnerFilter = 'all' | 'personal' | 'team' | 'subscription'

export function buildOwnerFilter(owner: OwnerFilter): string {
  if (owner === 'all') return ''
  return `owner:${owner}`
}

export function OwnerFilterTabs({ owner, onChange, hasTeam, hasSubscription }: {
  owner: OwnerFilter
  onChange: (v: OwnerFilter) => void
  hasTeam: boolean
  hasSubscription: boolean
}) {
  // 部署名（例: 救急）が設定されていればそれを表示。未設定なら「部署」。
  // 全タブ共通のコンポーネントなので、ここで設定から直接読むことで
  // 呼び出し元ごとの渡し忘れ（再発の温床）を防ぐ。
  const teamLabel = getSettings()?.teamLabel || ''
  const teamTabLabel = teamLabel.trim() ? teamLabel.trim() : '部署'
  // 部署タブ・プレミアムタブは常に表示（未接続は薄くグレーアウト）
  const options: { id: OwnerFilter; label: string; inactive?: boolean }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    ...(hasTeam || true ? [{ id: 'team' as OwnerFilter, label: teamTabLabel, inactive: !hasTeam }] : []),
    { id: 'subscription' as OwnerFilter, label: hasSubscription ? '⭐ プレミアム' : '🔒 プレミアム', inactive: !hasSubscription },
  ]
  const openSettings = useContext(OpenSettingsContext)
  return (
    <div className="mb-2">
      <div className="flex gap-1 flex-wrap">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
              owner === o.id
                ? o.id === 'subscription' && !hasSubscription
                  ? 'bg-purple-500 text-white'
                  : 'bg-brand-600 text-white'
                : o.inactive
                  ? 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border border-gray-200 dark:border-gray-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* 部署未接続のまま部署フィルタを選んだ場合の案内（全タブ共通でここに一元実装） */}
      {owner === 'team' && !hasTeam && (
        <div className="mt-2 bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">🏥 部署の共有DBは未接続です</p>
          <p className="text-xs text-brand-600 dark:text-brand-400 leading-relaxed">
            職場で共有しているNotionDBをつなぐと、部署の知識もここで検索できます。代表者から共有された接続情報（トークンとDBのURL）を設定に登録してください。
          </p>
          {openSettings && (
            <button
              onClick={() => openSettings('team')}
              className="text-xs font-semibold bg-white dark:bg-gray-800 text-brand-600 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-700 px-3 py-1.5 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
            >
              ⚙️ 部署DB設定を開く
            </button>
          )}
        </div>
      )}
      {owner === 'subscription' && hasSubscription && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed mt-1.5">
          ※ 掲載内容は参考情報です。最新性・正確性を保証するものではありません。臨床判断はご自身の責任で行ってください（
          <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項</a>
          ）。
        </p>
      )}
    </div>
  )
}

