'use client'
// 「外で調べる」のシート。行き先を押すと、問いを入れた状態で外のサイトを開く。
// 開く前に「外へ出た」ことを端末に覚え（setPending）、アプリに戻ったときに
// 「見つかりましたか？」のシート（TrailReturnSheet）を出せるようにする。
//
// 行き先はボタンではなく本物のリンク（<a target="_blank">）にする。iPhone のホーム画面の
// アプリでは、スクリプトで開く窓は止められることがあるが、リンクを押した操作は止められない。
import { X, ExternalLink } from 'lucide-react'
import { OUTSIDE_DESTS } from '@/lib/trail/outside'
import { setPending } from '@/lib/trail/pending'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

export function TrailOutsideSheet({
  query,
  ensureLookupId,
  onClose,
}: {
  query: string
  ensureLookupId: () => Promise<string | null>
  onClose: () => void
}) {
  useBodyScrollLock()

  const onPick = (dest: string) => {
    const at = Date.now()
    setPending({ lookupId: null, query, dest, at })
    // 記録はリンクを開く操作を待たせない（外へ出たあとに届けば足りる）。keepalive で、
    // 画面が裏へ回っても送り切る。届かなくても外で調べること自体は止めない。
    void ensureLookupId().then((lookupId) => {
      if (lookupId) setPending({ lookupId, query, dest, at })
      return fetch('/api/trail/outside', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookupId, dest }),
        keepalive: true,
      })
    }).catch(() => {})
    // 開いた直後にシートを閉じる（戻ってきたとき、このシートが残っていると二重になる）。
    setTimeout(onClose, 0)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-3 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="外で調べる"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-gray-900 dark:text-white">外で調べる</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              「{query}」を入れて開きます。戻ってきたら、見つけたものを一言で残せます。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 -mt-1 -mr-1 w-11 h-11 grid place-items-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <ul className="border-t border-gray-100 dark:border-gray-700">
          {OUTSIDE_DESTS.map((d) => (
            <li key={d.key} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700">
              <a
                href={d.url(query)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onPick(d.key)}
                className="flex items-center gap-3 min-h-[56px] px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-gray-900 dark:text-white">{d.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{d.hint}</span>
                </span>
                <ExternalLink className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
