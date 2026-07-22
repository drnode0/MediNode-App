'use client'

// タブ共通の所有者フィルタ（全て/個人/部署/プレミアム）。page.tsx から分割。

import { useContext } from 'react'
import { getSettings } from '@/lib/settings'
import { OpenSettingsContext } from './SearchErrors'
import { Star, Lock } from 'lucide-react'

// 'team:<id>' は追加部署（先行体験）の特定部署を指す。<id> は各部署の medicalDbId。
// bare 'team' は「全部署」または部署未接続の空状態を表す（従来挙動を保持）。
export type OwnerFilter = 'all' | 'personal' | 'team' | 'subscription' | `team:${string}`

// team 系（bare 'team' / 'team:<id>'）かどうか。
export function isTeamOwner(o: OwnerFilter): boolean {
  return o === 'team' || o.startsWith('team:')
}

// 'team:<id>' なら <id> を返す。bare 'team' や非team は null。
export function teamIdOf(o: OwnerFilter): string | null {
  return o.startsWith('team:') ? o.slice('team:'.length) : null
}

export function buildOwnerFilter(owner: OwnerFilter): string {
  if (owner === 'all') return ''
  // 部署は Algolia に無い（Notion 直読み）。特定部署も含め owner:team に正規化する
  // （Algolia 側は team ヒット無し＝空。実際の部署絞り込みは Notion ヒット側で行う）。
  if (isTeamOwner(owner)) return 'owner:team'
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
  const settings = getSettings()
  const teamLabel = settings?.teamLabel || ''
  const teamTabLabel = teamLabel.trim() ? teamLabel.trim() : '部署'
  const primaryTeamId = settings?.teamNotionMedicalDbId || ''
  // 追加部署（先行体験）。label と medicalDbId が揃ったものだけチップ化。
  const additional = (settings?.additionalTeams ?? []).filter((t) => t.label?.trim() && t.medicalDbId)

  // 部署チップ: 接続済みなら primary 部署 ＋ 追加部署ぶんを並べる。
  // primary は medicalDbId があれば 'team:<id>'、無ければ bare 'team'（全部署・従来挙動）。
  // 未接続なら bare 'team' の非活性チップ1つ（従来どおり未接続案内の入口）。
  const teamChips: { id: OwnerFilter; label: string; inactive?: boolean }[] = hasTeam
    ? [
        { id: (primaryTeamId ? `team:${primaryTeamId}` : 'team') as OwnerFilter, label: teamTabLabel },
        ...additional.map((t) => ({ id: `team:${t.medicalDbId}` as OwnerFilter, label: t.label.trim() })),
      ]
    : [{ id: 'team' as OwnerFilter, label: teamTabLabel, inactive: true }]

  // 部署タブ・プレミアムタブは常に表示（未接続は薄くグレーアウト）
  const options: { id: OwnerFilter; label: string; inactive?: boolean }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    ...teamChips,
    { id: 'subscription' as OwnerFilter, label: 'プレミアム', inactive: !hasSubscription },
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
            {o.id === 'subscription' && (
              hasSubscription
                ? <Star className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                : <Lock className="w-3 h-3 inline -mt-0.5 mr-0.5" />
            )}
            {o.label}
          </button>
        ))}
      </div>
      {/* 部署未接続のまま部署フィルタを選んだ場合の案内（全タブ共通でここに一元実装） */}
      {owner === 'team' && !hasTeam && (
        <div className="mt-2 bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">部署の共有DBは未接続です</p>
          <p className="text-xs text-brand-600 dark:text-brand-400 leading-relaxed">
            職場で共有しているNotionDBをつなぐと、部署の知識もここで検索できます。代表者から共有された接続情報（トークンとDBのURL）を設定に登録してください。
          </p>
          {openSettings && (
            <button
              onClick={() => openSettings('team')}
              className="text-xs font-semibold bg-white dark:bg-gray-800 text-brand-600 dark:text-brand-300 ring-1 ring-brand-200 dark:ring-brand-700 px-3 py-1.5 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
            >
              部署DB設定を開く
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

