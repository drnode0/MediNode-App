'use client'

// アカウント一覧の1人分。常時表示は「メール・区分・カード・アクティブ度・貢献」だけに
// 絞り、残りは展開（detail）へ。PC/スマホ共通の縦積み構造（幅分岐コードを書かない）。
// 判定・整形は呼び出し側（AdminLedgerClient）が済ませ、ここは純表示に徹する。

import type { ReactNode } from 'react'
import {
  Flame,
  Moon,
  CircleDashed,
  Circle,
  CreditCard,
  MessageCircleQuestion,
  ThumbsUp,
  ChevronDown,
} from 'lucide-react'

export type PersonRowProps = {
  email: string | null
  userId: string
  kindBadge: ReactNode
  hasStripe: boolean
  band: 'week' | 'month' | 'older' | 'never'
  lastSeenLabel: string
  cqCount: number
  voteCount: number
  expanded: boolean
  onToggle: () => void
  detail: ReactNode
}

// アクティブ度のアイコンと色（🔥→Flame 等・絵文字はUI装飾に使わない方針）。
const BAND_UI = {
  week: { Icon: Flame, cls: 'text-orange-500 dark:text-orange-400', label: '7日以内に利用' },
  month: { Icon: Moon, cls: 'text-sky-500 dark:text-sky-400', label: '30日以内に利用' },
  older: { Icon: CircleDashed, cls: 'text-gray-400 dark:text-gray-500', label: '31日以上前' },
  never: { Icon: Circle, cls: 'text-gray-300 dark:text-gray-600', label: '利用形跡なし' },
} as const

export function PersonRow(props: PersonRowProps) {
  const { Icon, cls, label } = BAND_UI[props.band]
  return (
    <li className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        className="w-full px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {/* 1段目: アクティブ度＋メール＋区分＋カード */}
        <span className={`inline-flex items-center gap-1 shrink-0 ${cls}`} title={label}>
          <Icon className="w-4 h-4" aria-hidden />
          <span className="text-xs tabular-nums">{props.lastSeenLabel}</span>
        </span>
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1">
          {props.email ?? '（メールなし）'}
        </span>
        {props.kindBadge}
        {props.hasStripe && (
          <span
            className="inline-flex items-center text-emerald-600 dark:text-emerald-400 shrink-0"
            title="カード登録あり（Stripe顧客）"
          >
            <CreditCard className="w-4 h-4" aria-hidden />
          </span>
        )}
        {/* 貢献: 0 は出さず行を静かに保つ */}
        {props.cqCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-purple-600 dark:text-purple-400 shrink-0"
            title={`CQ投稿 ${props.cqCount}件`}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" aria-hidden />
            {props.cqCount}
          </span>
        )}
        {props.voteCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-teal-600 dark:text-teal-400 shrink-0"
            title={`投票 ${props.voteCount}件`}
          >
            <ThumbsUp className="w-3.5 h-3.5" aria-hidden />
            {props.voteCount}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${props.expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {props.expanded && (
        <div className="px-3 pb-3 pt-1 bg-gray-50/60 dark:bg-gray-900/30">{props.detail}</div>
      )}
    </li>
  )
}
