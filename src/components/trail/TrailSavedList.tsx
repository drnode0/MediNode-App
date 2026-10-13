'use client'
// 検索の空の画面に出す「最近残したもの」と、調べた記録の扱い（記録のスイッチ・すべて消す）。
// 安心に関わる操作（止める・消す）は、記録が出てくる場所のすぐそばに置く（約束「本人の記録は本人が消せる」）。
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, ShieldCheck, Trash2, X } from 'lucide-react'
import { isTrailEnabled, isTrailRecording, setTrailRecording } from '@/lib/trail-flag'
import { formatTrailDate, shortHost } from '@/lib/trail/format'
import { TRAIL_SAVED_EVENT } from '@/lib/trail/pending'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

type Item = { id: string; query: string | null; title: string; note: string; url: string | null; origin: string; createdAt: string }

const ORIGIN_LABEL: Record<string, string> = { lookup: '外で調べて残した', paste: '貼り付け' }
const SHOW_MAX = 5

export function TrailSavedList() {
  const enabled = isTrailEnabled()
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const load = useCallback(() => {
    fetch('/api/trail/saves')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { items?: Item[] }) => { setItems(j.items ?? []); setFailed(false) })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (!enabled) return
    load()
    window.addEventListener(TRAIL_SAVED_EVENT, load)
    return () => window.removeEventListener(TRAIL_SAVED_EVENT, load)
  }, [enabled, load])

  if (!enabled) return null

  const remove = async (id: string) => {
    setConfirmId(null)
    const before = items
    setItems((cur) => cur?.filter((i) => i.id !== id) ?? null)
    const res = await fetch(`/api/trail/saves?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
    // 消せなかったら元に戻す（消えたように見せて残っている、を作らない）。
    if (!res || !res.ok) { setItems(before); setFailed(true) }
  }

  const now = new Date()
  const shown = (items ?? []).slice(0, SHOW_MAX)

  return (
    <section aria-label="最近残したもの" className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">最近残したもの</p>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="min-h-[32px] inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          調べた記録の扱い
        </button>
      </div>
      {failed && (
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">読み込めませんでした。通信を確かめて、検索の画面を開き直してください。</p>
      )}
      {items && items.length === 0 && (
        <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          まだありません。検索して見つからなかったときは「外で調べる」から出て、戻ってきたら一言で残せます。
        </p>
      )}
      {shown.length > 0 && (
        <ul className="rounded-2xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {shown.map((i) => {
            const host = shortHost(i.url)
            const head = i.note || i.title || host || i.query || ''
            return (
              <li key={i.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-[15px] leading-relaxed text-gray-900 dark:text-white break-words line-clamp-3">{head}</p>
                  {confirmId !== i.id && (
                    <button type="button" onClick={() => setConfirmId(i.id)} aria-label="この1件を消す" className="shrink-0 -mr-2 -mt-1 w-10 h-10 grid place-items-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatTrailDate(i.createdAt, now)}</span>
                  {ORIGIN_LABEL[i.origin] && <span>{ORIGIN_LABEL[i.origin]}</span>}
                  {i.query && <span className="break-all">問い「{i.query}」</span>}
                  {i.url && host && (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-[32px] font-semibold text-brand-700 dark:text-brand-300">
                      {host}
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
                {confirmId === i.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 text-xs text-gray-600 dark:text-gray-300">この1件を消します。元には戻せません。</span>
                    <button type="button" onClick={() => setConfirmId(null)} className="min-h-[36px] px-3 text-xs text-gray-500">やめる</button>
                    <button type="button" onClick={() => remove(i.id)} className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-gray-800 dark:text-gray-100 ring-1 ring-gray-300 dark:ring-gray-600">消す</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {settingsOpen && <RecordSettingsSheet onClose={() => setSettingsOpen(false)} />}
    </section>
  )
}

// 調べた記録の扱い。何を残しているか・誰が見られるかを先に書き、止める・消すを置く。
function RecordSettingsSheet({ onClose }: { onClose: () => void }) {
  useBodyScrollLock()
  const [recording, setRecording] = useState(isTrailRecording())
  const [saveFailed, setSaveFailed] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting' | 'done' | 'failed'>('idle')

  const toggle = () => {
    const next = !recording
    if (setTrailRecording(next)) { setRecording(next); setSaveFailed(false) } else setSaveFailed(true)
  }

  const deleteAll = async () => {
    setDeleteState('deleting')
    const res = await fetch('/api/trail/lookups', { method: 'DELETE' }).catch(() => null)
    setDeleteState(res && res.ok ? 'done' : 'failed')
    setConfirmAll(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-3 sm:p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="調べた記録の扱い"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start gap-3">
          <p className="flex-1 text-base font-bold text-gray-900 dark:text-white">調べた記録の扱い</p>
          <button type="button" onClick={onClose} aria-label="閉じる" className="shrink-0 -mt-2 -mr-2 w-11 h-11 grid place-items-center rounded-xl text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300 list-disc pl-5">
          <li>検索した言葉と日時、「外で調べる」で開いた先を、あなたのアカウントに残します。</li>
          <li>アプリで見られるのはあなただけです。管理の画面でも中身は表示せず、数えるのは件数だけです。</li>
          <li>次に同じことを調べたとき、「前にも調べています」に使います。</li>
        </ul>

        <button
          type="button"
          role="switch"
          aria-checked={recording}
          onClick={toggle}
          className="mt-4 w-full flex items-center gap-3 px-4 py-3.5 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 text-left"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">調べた言葉を残す</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">オフの間は記録しません。残したもの（リンク・一言）は、オフでも残せます。</span>
          </span>
          <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${recording ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${recording ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
        {saveFailed && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">この端末では切り替えを保存できませんでした。セットアップを終えてから、もう一度押してください。</p>}

        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          {deleteState === 'done' ? (
            <p role="status" className="text-sm text-gray-700 dark:text-gray-200">調べた言葉の記録をすべて消しました。残したものは消えていません。</p>
          ) : confirmAll ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-800 dark:text-gray-100">調べた言葉の記録をすべて消します。元には戻せません。残したもの（リンク・一言）は消えません。</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmAll(false)} className="flex-1 min-h-[44px] rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">やめる</button>
                <button type="button" onClick={deleteAll} disabled={deleteState === 'deleting'} className="flex-1 min-h-[44px] rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold disabled:opacity-50">
                  {deleteState === 'deleting' ? '消しています…' : 'すべて消す'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="w-full min-h-[44px] rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">
              調べた言葉の記録をすべて消す
            </button>
          )}
          {deleteState === 'failed' && <p role="alert" className="mt-2 text-xs text-gray-600 dark:text-gray-300">消せませんでした。通信を確かめて、もう一度押してください。</p>}
        </div>
      </div>
    </div>
  )
}
