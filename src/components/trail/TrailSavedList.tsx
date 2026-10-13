'use client'
// 検索の空の画面に出す「メモ」（残したもの）と、検索履歴の設定（残す・消去）。
// 止める・消すは、記録が出てくる場所のすぐそばに置く（約束「本人の記録は本人が消せる」）。
// 説明の文は置かない（2026-10-13 本人の指示）。何を記録するかはプライバシーポリシーに書く。
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, History, Trash2, X } from 'lucide-react'
import { isTrailEnabled, isTrailRecording, setTrailRecording } from '@/lib/trail-flag'
import { formatTrailDate, shortHost } from '@/lib/trail/format'
import { outsideDest } from '@/lib/trail/outside'
import { TRAIL_SAVED_EVENT } from '@/lib/trail/pending'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

type Item = { id: string; query: string | null; title: string; note: string; url: string | null; origin: string; outside: string | null; createdAt: string }

const SHOW_MAX = 5
const TAG = 'inline-flex items-center h-5 px-1.5 rounded-md ring-1 ring-gray-300 dark:ring-gray-600 text-[11px] font-medium text-gray-600 dark:text-gray-300'

// 出どころの札。外部サイトから戻って残したものは行き先の名前、それ以外はアプリ。
function sourceLabel(i: Item): string {
  return outsideDest(i.outside)?.label ?? 'アプリ'
}

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
    <section aria-label="メモ" className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">メモ</p>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="min-h-[32px] inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <History className="w-3.5 h-3.5" aria-hidden="true" />
          検索履歴
        </button>
      </div>
      {failed && <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">読み込めませんでした</p>}
      {shown.length > 0 && (
        <ul className="rounded-2xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {shown.map((i) => {
            const host = shortHost(i.url)
            const head = i.note || i.title || i.query || host
            return (
              <li key={i.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-[15px] leading-relaxed text-gray-900 dark:text-white break-words line-clamp-3">{head}</p>
                  {confirmId !== i.id && (
                    <button type="button" onClick={() => setConfirmId(i.id)} aria-label="削除" className="shrink-0 -mr-2 -mt-1 w-10 h-10 grid place-items-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className={TAG}>{sourceLabel(i)}</span>
                  <span>{formatTrailDate(i.createdAt, now)}</span>
                  {i.query && i.query !== head && <span className="break-all">検索：{i.query}</span>}
                  {i.url && host && (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-[32px] font-semibold text-brand-700 dark:text-brand-300">
                      {host}
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
                {confirmId === i.id && (
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmId(null)} className="min-h-[36px] px-3 text-xs text-gray-500">キャンセル</button>
                    <button type="button" onClick={() => remove(i.id)} className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-gray-800 dark:text-gray-100 ring-1 ring-gray-300 dark:ring-gray-600">削除する</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {settingsOpen && <HistorySettingsSheet onClose={() => setSettingsOpen(false)} />}
    </section>
  )
}

function HistorySettingsSheet({ onClose }: { onClose: () => void }) {
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
        aria-label="検索履歴"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start gap-3">
          <p className="flex-1 text-base font-bold text-gray-900 dark:text-white">検索履歴</p>
          <button type="button" onClick={onClose} aria-label="閉じる" className="shrink-0 -mt-2 -mr-2 w-11 h-11 grid place-items-center rounded-xl text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={recording}
          onClick={toggle}
          className="mt-3 w-full flex items-center gap-3 px-4 min-h-[52px] rounded-xl ring-1 ring-gray-200 dark:ring-gray-700 text-left"
        >
          <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">履歴を残す</span>
          <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${recording ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${recording ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
        {saveFailed && <p role="alert" className="mt-2 text-xs text-gray-600 dark:text-gray-300">切り替えを保存できませんでした</p>}

        <div className="mt-3">
          {deleteState === 'done' ? (
            <p role="status" className="min-h-[44px] flex items-center justify-center text-sm text-gray-700 dark:text-gray-200">履歴を消去しました</p>
          ) : confirmAll ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmAll(false)} className="flex-1 min-h-[44px] rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">キャンセル</button>
              <button type="button" onClick={deleteAll} disabled={deleteState === 'deleting'} className="flex-1 min-h-[44px] rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold disabled:opacity-50">
                消去する
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="w-full min-h-[44px] rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">
              履歴を消去
            </button>
          )}
          {deleteState === 'failed' && <p role="alert" className="mt-2 text-xs text-gray-600 dark:text-gray-300">消去できませんでした。もう一度押してください</p>}
        </div>
      </div>
    </div>
  )
}
