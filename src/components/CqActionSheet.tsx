'use client'
import { Search, Send, ExternalLink, X, Sparkles } from 'lucide-react'
import { formatCqAge, type CqSeed } from '@/lib/floating-cq'
import { dispatchLabel, type DispatchState } from '@/lib/cq-dispatch'
import { ASK_SHELF_MODAL_TITLE } from '@/lib/ask-shelf/copy'

// 浮かんでいる問いを触ったときに出るパネル。一手を3つだけ並べる。
// アプリからNotionのページは書き換えないので、片づけもNotionへ渡す。
export function CqActionSheet({
  cq,
  onClose,
  onSearch,
  onAsk,
  dispatch,
}: {
  // 配置（座標・軌道）は使わないので要求しない。折りたたみリストから開くときに
  // 嘘の座標を作らなくて済む。
  cq: CqSeed & { newAnswerCount: number }
  onClose: () => void
  onSearch: () => void
  // 届け先（プレミアム）が無いときは null。ボタンごと出さない。
  onAsk: (() => void) | null
  // 作者に投げたことがある問いだけ入る。投げていなければ undefined。
  dispatch?: DispatchState
}) {
  const lit = cq.newAnswerCount > 0
  // 「今日」の判定はレンダーごとに取り直す（開きっぱなしで日付が変わるほどの画面ではない）。
  const age = formatCqAge(cq.createdAt, new Date())
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
          {/* いつ残した問いか。泡には出さず、手を動かす直前のここだけに置く
              （全部の泡に日付を並べると、溜めた日数を毎回見せる催促になる）。 */}
          {age && <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{age}</p>}
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
          {/* 一度投げた問いは「投げる」を出さない。同じ疑問を二重に送らせない。
              代わりに、いま作者側でどこまで進んでいるかを置く。 */}
          {dispatch ? (
            <div className="flex items-center gap-3 px-3 py-3">
              <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                <Send className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-teal-800 dark:text-teal-200">
                  {dispatchLabel(dispatch)}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {dispatch.stage === 'answered'
                    ? '上の「この文言で探す」から読めます'
                    : dispatch.voteCount && dispatch.voteCount > 0
                      ? '票が多い疑問から答えが書かれます'
                      : '答えが出たらお知らせが届きます'}
                </span>
              </span>
            </div>
          ) : (
            onAsk && (
              <SheetButton
                Icon={Send}
                label={`${ASK_SHELF_MODAL_TITLE}として送る`}
                note="みんなの臨床疑問に並び、答えが出たら通知が届く"
                onClick={onAsk}
              />
            )
          )}
          {/* 片づけるのもNotionで行う。アプリからページを書き換えないのが元々の線引きで、
              「解決した」ボタンはそれを跨いでいた（2026-08-08に撤去）。
              知識レベルを 💡 ナレッジ に変えて再同期すれば、この泡は消える。 */}
          <SheetButton
            Icon={ExternalLink}
            label="Notionで解決しに行く"
            note={
              lit
                ? '答えが出ているなら、知識レベルを 💡 ナレッジ に変える'
                : '書いて、知識レベルを 💡 ナレッジ に変える'
            }
            onClick={() => window.open(cq.notionUrl, '_blank', 'noopener,noreferrer')}
          />
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
