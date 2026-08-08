'use client'
import { Search, Send, ExternalLink, Check, X, Sparkles } from 'lucide-react'
import type { PlacedCq } from '@/lib/floating-cq'

// 浮かんでいる問いを触ったときに出るパネル。一手を4つだけ並べる。
// 「解決した」は確認を挟まない（押した直後に「元に戻す」を数秒残す方が手が軽い）。
export function CqActionSheet({
  cq,
  onClose,
  onSearch,
  onAsk,
  onResolve,
  resolving,
  canResolve,
}: {
  cq: PlacedCq
  onClose: () => void
  onSearch: () => void
  // 届け先（プレミアム）が無いときは null。ボタンごと出さない。
  onAsk: (() => void) | null
  onResolve: () => void
  resolving: boolean
  // 個人Notionが無い＝書き込み先が無いときは false。
  canResolve: boolean
}) {
  const lit = cq.newAnswerCount > 0
  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="この問いをどうするか"
      >
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-base font-bold leading-relaxed text-gray-900 dark:text-white">
              {cq.title}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="shrink-0 -mt-1 -mr-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {lit && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-full px-2.5 py-1">
              <Sparkles className="w-3.5 h-3.5" />
              この問いを残したあとに、新しい答えが{cq.newAnswerCount}件
            </p>
          )}
        </div>

        <div className="p-2">
          <SheetButton
            Icon={Search}
            label="この文言で探す"
            note={lit ? '新しく増えた分も含めて横断する' : '自分・部署・プレミアムを横断する'}
            emphasis={lit}
            onClick={onSearch}
          />
          {onAsk && (
            <SheetButton
              Icon={Send}
              label="作者に投げる"
              note="みんなの臨床疑問へ。解決したら通知が届く"
              onClick={onAsk}
            />
          )}
          <SheetButton
            Icon={ExternalLink}
            label="Notionで開く"
            note="自分で書きに行く"
            onClick={() => window.open(cq.notionUrl, '_blank', 'noopener,noreferrer')}
          />
          {canResolve && (
            <SheetButton
              Icon={Check}
              label={resolving ? '記録しています…' : '解決した'}
              note="ナレッジに変えて、この問いを片づける"
              onClick={onResolve}
              disabled={resolving}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SheetButton({
  Icon,
  label,
  note,
  onClick,
  emphasis = false,
  disabled = false,
}: {
  Icon: typeof Search
  label: string
  note: string
  onClick: () => void
  emphasis?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors disabled:opacity-50 ${
        emphasis
          ? 'bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
      }`}
    >
      <span
        className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
          emphasis
            ? 'bg-brand-500 text-white'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
        }`}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-gray-900 dark:text-white">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{note}</span>
      </span>
    </button>
  )
}
